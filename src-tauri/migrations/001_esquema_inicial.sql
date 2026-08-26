-- SwiftCalendar — migración 001
-- Esquema inicial completo. Corresponde a la sección 3 de la especificación.
--
-- FORMATO DE FECHA Y HORA
-- Todas las columnas de fecha guardan texto 'YYYY-MM-DD HH:MM'. Se ordenan
-- alfabéticamente igual que cronológicamente, así que las comparaciones de rango
-- funcionan sin convertir nada.
--
-- Lo que se guarda es SIEMPRE la hora de reloj, nunca un instante en UTC. Qué
-- significa esa hora lo decide 'hora_fija':
--   hora_fija = 1  la hora de reloj es la hora, y no cambia nunca
--   hora_fija = 0  la hora de reloj está escrita en 'zona_origen', y hay que
--                  resolverla a la zona del equipo antes de mostrarla
-- Esa resolución la hace una sola función del sistema. Ningún otro código toca
-- zonas horarias.



-- ---------------------------------------------------------------------------
-- GRUPO
-- ---------------------------------------------------------------------------

CREATE TABLE grupo (
  id          INTEGER PRIMARY KEY,
  nombre      TEXT    NOT NULL UNIQUE
              CHECK (length(trim(nombre)) > 0),
  color       TEXT    NOT NULL
              CHECK (length(color) = 7 AND color GLOB '#[0-9a-fA-F]*'),
  orden       INTEGER NOT NULL,
  es_default  INTEGER NOT NULL DEFAULT 0
              CHECK (es_default IN (0, 1))
);

-- Existe un único grupo por defecto. Es "Otro", y no se puede borrar ni renombrar.
-- Esa protección vive en la capa de comandos; acá solo se garantiza que no haya dos.
CREATE UNIQUE INDEX idx_grupo_default ON grupo(es_default) WHERE es_default = 1;

CREATE INDEX idx_grupo_orden ON grupo(orden);


-- ---------------------------------------------------------------------------
-- EVENTO
-- ---------------------------------------------------------------------------
--
-- Una serie repetida es UNA fila con 'rrule'. Las ocurrencias se calculan al
-- vuelo y nunca se guardan.
--
-- Un evento creado por "solo esta" es una fila normal con rrule nulo, apuntada
-- desde la tabla de excepciones. Aparece en el calendario por el recorrido
-- normal, no por un camino especial.

CREATE TABLE evento (
  id                INTEGER PRIMARY KEY,

  grupo_id          INTEGER NOT NULL
                    REFERENCES grupo(id) ON DELETE RESTRICT,

  titulo            TEXT    NOT NULL
                    CHECK (length(trim(titulo)) > 0),

  inicio            TEXT    NOT NULL
                    CHECK (inicio GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]'),

  -- Nulo significa "sin fin declarado", NO "todo el día".
  -- Un evento de todo el día que dura tres días guarda acá su último día.
  fin               TEXT
                    CHECK (fin IS NULL OR fin >= inicio),

  todo_el_dia       INTEGER NOT NULL DEFAULT 0
                    CHECK (todo_el_dia IN (0, 1)),

  hora_fija         INTEGER NOT NULL DEFAULT 1
                    CHECK (hora_fija IN (0, 1)),

  -- Zona IANA. Obligatoria si la hora es adaptable, prohibida si es fija.
  zona_origen       TEXT
                    CHECK ((hora_fija = 0) = (zona_origen IS NOT NULL)),

  importancia       TEXT    NOT NULL DEFAULT 'comun'
                    CHECK (importancia IN ('comun', 'importante', 'urgente')),

  -- Nulo hereda el color del grupo.
  color             TEXT
                    CHECK (color IS NULL OR
                           (length(color) = 7 AND color GLOB '#[0-9a-fA-F]*')),

  descripcion       TEXT,
  ubicacion         TEXT,
  url               TEXT,

  -- Rutas relativas a la raíz de la carpeta de datos.
  -- La miniatura se genera al copiar la imagen: van juntas o no van.
  imagen            TEXT,
  imagen_thumb      TEXT
                    CHECK ((imagen IS NULL) = (imagen_thumb IS NULL)),

  rrule             TEXT,

  recordatorio_min  INTEGER
                    CHECK (recordatorio_min IS NULL OR recordatorio_min >= 0),

  creado            TEXT    NOT NULL,
  modificado        TEXT    NOT NULL,

  -- Un día es un día: los eventos de todo el día no eligen tipo de hora.
  CHECK (todo_el_dia = 0 OR hora_fija = 1)
);

CREATE INDEX idx_evento_inicio ON evento(inicio);
CREATE INDEX idx_evento_grupo  ON evento(grupo_id);

-- Las series se recorren aparte del rango de fechas, porque una serie que empezó
-- hace dos años sigue produciendo ocurrencias este mes.
CREATE INDEX idx_evento_serie ON evento(id) WHERE rrule IS NOT NULL;


-- ---------------------------------------------------------------------------
-- ADJUNTO
-- ---------------------------------------------------------------------------

CREATE TABLE adjunto (
  id               INTEGER PRIMARY KEY,
  evento_id        INTEGER NOT NULL
                   REFERENCES evento(id) ON DELETE CASCADE,
  ruta             TEXT    NOT NULL,
  nombre_original  TEXT    NOT NULL,
  tamano           INTEGER NOT NULL CHECK (tamano >= 0)
);

CREATE INDEX idx_adjunto_evento ON adjunto(evento_id);


-- ---------------------------------------------------------------------------
-- EXCEPCION
-- ---------------------------------------------------------------------------
--
-- La ocurrencia indicada por 'fecha_original' SIEMPRE se excluye del cálculo de
-- la serie. Si 'override_id' es nulo, esa ocurrencia no existe. Si apunta a un
-- evento, ese evento ocupa su lugar. Un solo camino cubre borrar y modificar.
--
-- Si el override se borra, la excepción se queda sin él y la ocurrencia pasa a
-- estar simplemente borrada. Es el comportamiento correcto: nadie quiere que
-- borrar la clase del lunes 10 haga reaparecer la original.

CREATE TABLE excepcion (
  evento_id       INTEGER NOT NULL
                  REFERENCES evento(id) ON DELETE CASCADE,
  fecha_original  TEXT    NOT NULL,
  override_id     INTEGER
                  REFERENCES evento(id) ON DELETE SET NULL,

  PRIMARY KEY (evento_id, fecha_original)
) WITHOUT ROWID;

CREATE INDEX idx_excepcion_override ON excepcion(override_id)
  WHERE override_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- NOTIFICACION
-- ---------------------------------------------------------------------------
--
-- Registro persistente con estado, no un aviso que pasa. Nace cuando llega su
-- hora y sigue existiendo hasta que el usuario la marca como vista.
--
-- La clave única de evento más ocurrencia es lo que impide duplicar una
-- notificación si el procedimiento de generación corre dos veces sobre el mismo
-- rango.

CREATE TABLE notificacion (
  id          INTEGER PRIMARY KEY,
  evento_id   INTEGER NOT NULL
              REFERENCES evento(id) ON DELETE CASCADE,
  ocurrencia  TEXT    NOT NULL,
  momento     TEXT    NOT NULL,
  estado      TEXT    NOT NULL DEFAULT 'pendiente'
              CHECK (estado IN ('pendiente', 'vista')),

  UNIQUE (evento_id, ocurrencia)
);

CREATE INDEX idx_notificacion_pendiente ON notificacion(momento)
  WHERE estado = 'pendiente';


-- ---------------------------------------------------------------------------
-- AJUSTE
-- ---------------------------------------------------------------------------

CREATE TABLE ajuste (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
) WITHOUT ROWID;


-- ---------------------------------------------------------------------------
-- SEMILLA
-- ---------------------------------------------------------------------------

INSERT INTO grupo (nombre, color, orden, es_default)
VALUES ('Otro', '#8b857e', 0, 1);

-- 'generado_hasta' marca el instante hasta el cual ya se crearon registros de
-- notificación. No significa "visto": que una notificación exista y que la hayas
-- visto son dos cosas separadas a propósito.
INSERT INTO ajuste (clave, valor) VALUES
  ('generado_hasta', datetime('now', 'localtime')),
  ('tema',           'oscuro'),
  ('densidad',       'comoda'),
  ('bandeja',        '1'),
  ('arranque',       '0');


