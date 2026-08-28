-- SwiftCalendar — migración 006
--
-- El filtro se recuerda entre sesiones. Es una preferencia: el usuario apagó un
-- grupo porque no quiere verlo, no porque no quisiera verlo ese rato.
--
-- El último mes visto NO se guarda, aunque la especificación lo pedía junto al
-- filtro. Son cosas distintas: el filtro es cómo quiere ver las cosas, el mes es
-- dónde estaba mirando. Un calendario que abre en marzo porque en marzo lo
-- cerraste obliga a volver a hoy cada vez, y el botón con la fecha de hoy ya
-- está ahí para el salto contrario.
--
-- Los grupos se guardan por los que están APAGADOS y no por los visibles, igual
-- que en memoria: así un grupo creado después de guardar nace visible sin que
-- nadie tenga que preguntarse si es nuevo.
--
-- Vacío significa "ninguno apagado", que es lo mismo que la lista completa de
-- importancias significa para el otro filtro.

INSERT INTO ajuste (clave, valor) VALUES
  ('filtro_grupos_ocultos', ''),
  ('filtro_importancias',   'comun,importante,urgente');
