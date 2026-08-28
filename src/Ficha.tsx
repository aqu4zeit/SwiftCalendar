import { useEffect, useState, type ReactNode } from "react";
import { openPath } from "@tauri-apps/plugin-opener";

import {
  borrarEvento,
  leerEvento,
  tamanoLegible,
  urlDeArchivo,
  type Edicion,
  type EventoDetalle,
  type Grupos,
  type Instancia,
} from "./api";
import {
  edicionSegun,
  exportarAArchivo,
  ocurrenciaSegun,
  PreguntaAlcance,
  type Alcance,
} from "./acciones";
import {
  duracion,
  fechaCompacta,
  fechaDe,
  horaDe,
  rangoCompacto,
  type FormatoHora,
} from "./fecha";
import { RECORDATORIOS } from "./MasOpciones";
import { desdeRrule, textoRepeticion } from "./rrule";
import { useVelo } from "./flotante";

interface Props {
  instancia: Instancia;
  grupos: Grupos;
  /** La carpeta de datos: lo guardado es relativo a ella. */
  carpeta: string;
  formatoHora: FormatoHora;
  /** Falso si hay otra ventana encima: el teclado lo cierra a él, no a este. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  onCerrar: () => void;
  onEditar: (edicion: Edicion) => void;
  onBorrado: () => void;
}

const NOMBRE_IMPORTANCIA = {
  comun: "Común",
  importante: "Importante",
  urgente: "Urgente",
} as const;

/** Qué se hace cuando el evento se repite. */
/**
 * Desde qué proporción una imagen va ancha arriba en vez de al costado.
 *
 * Arriba tiene el ancho de la ficha y un tope de alto, así que una imagen que
 * no sea claramente panorámica se recortaría por la mitad para caber. Al costado
 * entra completa, y los datos ocupan lo que queda.
 */
const PANORAMICA = 1.6;

export function Ficha({
  instancia,
  grupos,
  carpeta,
  formatoHora,
  activo,
  saliendo,
  onCerrar,
  onEditar,
  onBorrado,
}: Props) {
  const [detalle, setDetalle] = useState<EventoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  // Qué acción está esperando que se elija el alcance, o la confirmación.
  const [preguntando, setPreguntando] = useState<"editar" | "borrar" | null>(
    null,
  );
  const [alcance, setAlcance] = useState<Alcance>("solo_esta");
  const [borrando, setBorrando] = useState(false);

  // Dónde va la imagen. La proporción no está en la base, así que la dice el
  // archivo al cargarse.
  const [ancha, setAncha] = useState<boolean | null>(null);

  function medir(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setAncha(img.naturalWidth / img.naturalHeight >= PANORAMICA);
  }

  useEffect(() => {
    let vigente = true;

    leerEvento(instancia.evento_id)
      .then((e) => vigente && setDetalle(e))
      .catch((e: unknown) => vigente && setError(String(e)));

    return () => {
      vigente = false;
    };
  }, [instancia.evento_id]);

  useEffect(() => {
    if (!activo) return;

    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        if (preguntando) setPreguntando(null);
        else onCerrar();
      }
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  });

  const grupo = grupos.todos.find((g) => g.id === instancia.grupo_id);

  const hayImagen = Boolean(detalle?.imagen) && detalle?.imagen_existe === true;
  const imagen = !hayImagen
    ? "no"
    : ancha === null
      ? "midiendo"
      : ancha
        ? "ancha"
        : "lado";
  const esSerie = detalle?.rrule != null;

  function editar(elegido: Alcance) {
    if (!detalle) return;
    onEditar(edicionSegun(detalle, instancia, esSerie, elegido));
  }

  async function borrar(elegido: Alcance) {
    setBorrando(true);
    try {
      await borrarEvento(
        instancia.evento_id,
        ocurrenciaSegun(instancia, esSerie, elegido),
      );
      onBorrado();
    } catch (e: unknown) {
      setError(String(e));
      setBorrando(false);
      setPreguntando(null);
    }
  }

  /** Sin serie no hay nada que preguntar sobre el alcance. */
  function pedir(accion: "editar" | "borrar") {
    if (accion === "editar" && !esSerie) {
      editar("todas");
      return;
    }
    setAlcance("solo_esta");
    setPreguntando(accion);
  }

  const velo = useVelo(onCerrar);

  async function exportar() {
    if (!detalle) return;
    setExportando(true);
    try {
      await exportarAArchivo(detalle);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setExportando(false);
    }
  }

  return (
    <div
      className={saliendo ? "velo saliendo" : "velo"}
      {...velo}
    >
      <div className="ficha">
        <div className="ficha-cab">
          {/* Exportar vive acá y no en el pie: el pie ya tiene Editar y Borrar,
              y un tercer botón dejaría el destructivo entre otros dos. */}
          <button
            type="button"
            className="cerrar"
            data-texto="Exportar evento"
            disabled={!detalle || exportando}
            onClick={exportar}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 15V3M8 7l4-4 4 4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
            </svg>
          </button>

          <button type="button" className="cerrar" onClick={onCerrar}>
            ✕
          </button>
        </div>

        {error && <div className="msg-error ficha-error">{error}</div>}

        {detalle && (
          <>
            <div className="ficha-cuerpo">
              {/* Un solo elemento, siempre el mismo, que cambia de sitio
                  cambiando la dirección del contenedor. Montar uno para medir y
                  otro para dibujar hacía que el archivo se decodificara dos
                  veces, y la primera vez con una imagen grande se nota.

                  Mientras no se sabe la proporción no se dibuja: elegir un sitio
                  y moverla después es un salto. */}
              <div className={`ficha-imagen ${imagen}`}>
                {imagen !== "no" && (
                  <img
                    src={urlDeArchivo(carpeta, detalle.imagen as string)}
                    alt=""
                    onLoad={medir}
                  />
                )}

                <div className="ficha-datos">
                  <h1>{detalle.titulo}</h1>

                  <div className="ficha-meta">
                    <Cuando instancia={instancia} formato={formatoHora} />
                  </div>

                  <div className="ficha-chips">
                {grupo && (
                  <span className="chip">
                    <span
                      className="punto"
                      style={{ background: grupo.color }}
                    />
                    {grupo.nombre}
                  </span>
                )}

                {instancia.importancia !== "comun" && (
                  <span className="chip">
                    <span
                      className="marca-chip"
                      style={
                        instancia.importancia === "urgente"
                          ? { background: instancia.color }
                          : { borderColor: instancia.color }
                      }
                    />
                    {NOMBRE_IMPORTANCIA[instancia.importancia]}
                  </span>
                )}

                    {instancia.de > 1 && (
                      <span className="chip">
                        Día {instancia.dia} de {instancia.de}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {detalle.imagen && !detalle.imagen_existe && (
                <p className="ficha-falta">
                  La imagen ya no está en la carpeta de datos.
                </p>
              )}

              {detalle.descripcion && (
                <p className="ficha-desc">{detalle.descripcion}</p>
              )}

              <Detalles detalle={detalle} carpeta={carpeta} />
            </div>

            <div className="ficha-pie">
              <button
                type="button"
                className="btn malo"
                onClick={() => pedir("borrar")}
              >
                Borrar
              </button>
              <button
                type="button"
                className="btn pri"
                onClick={() => pedir("editar")}
              >
                Editar
              </button>
            </div>
          </>
        )}
      </div>

      {preguntando && (
        <PreguntaAlcance
          accion={preguntando}
          detalle={detalle}
          instancia={instancia}
          esSerie={esSerie}
          alcance={alcance}
          ocupado={borrando}
          onAlcance={setAlcance}
          onCancelar={() => setPreguntando(null)}
          onSeguir={() =>
            preguntando === "borrar" ? void borrar(alcance) : editar(alcance)
          }
        />
      )}
    </div>
  );
}

/** La línea de fecha, hora y duración de esta ocurrencia. */
function Cuando({
  instancia,
  formato,
}: {
  instancia: Instancia;
  formato: FormatoHora;
}) {
  const partes: string[] = [];

  if (instancia.de > 1 && instancia.fin) {
    partes.push(
      rangoCompacto(fechaDe(instancia.inicio), fechaDe(instancia.fin)),
    );
  } else {
    partes.push(fechaCompacta(fechaDe(instancia.inicio)));
  }

  if (!instancia.todo_el_dia) {
    partes.push(
      instancia.fin
        ? `${horaDe(instancia.inicio, formato)} a ${horaDe(instancia.fin, formato)}`
        : horaDe(instancia.inicio, formato),
    );
  }

  // Un evento que abarca días se mide en días; uno de un día, en horas.
  if (instancia.de > 1) {
    partes.push(`${instancia.de} días`);
  } else if (instancia.fin && !instancia.todo_el_dia) {
    partes.push(duracion(instancia.inicio, instancia.fin));
  }

  return (
    <>
      {partes.map((parte, i) => (
        <span key={parte}>
          {i > 0 && <span className="sep">·</span>}
          {parte}
        </span>
      ))}
    </>
  );
}

/** Las filas que solo aparecen si su campo tiene algo. */
function Detalles({
  detalle,
  carpeta,
}: {
  detalle: EventoDetalle;
  carpeta: string;
}) {
  const recordatorio =
    detalle.recordatorio_min === null
      ? null
      : RECORDATORIOS.find((r) => r.valor === detalle.recordatorio_min)?.texto;

  const filas: { icono: ReactNode; texto: string }[] = [];

  if (detalle.ubicacion) {
    filas.push({
      icono: (
        <>
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 1116 0z" />
          <circle cx="12" cy="10" r="3" />
        </>
      ),
      texto: detalle.ubicacion,
    });
  }

  if (detalle.url) {
    filas.push({
      icono: (
        <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
      ),
      texto: detalle.url,
    });
  }

  if (detalle.rrule) {
    filas.push({
      icono: (
        <path d="M17 2l4 4-4 4M3 11V9a4 4 0 014-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 01-4 4H3" />
      ),
      texto: `Se repite ${textoRepeticion(desdeRrule(detalle.rrule))}`,
    });
  }

  if (detalle.cuando === "adaptable") {
    filas.push({
      icono: (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </>
      ),
      texto: "La hora se adapta a la zona horaria",
    });
  }

  if (recordatorio) {
    filas.push({
      icono: (
        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
      ),
      texto: `Recordatorio: ${recordatorio.toLowerCase()}`,
    });
  }

  if (filas.length === 0 && detalle.adjuntos.length === 0) return null;

  return (
    <div className="ficha-lista">
      {filas.map((fila) => (
        <div className="ficha-fila" key={fila.texto}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {fila.icono}
          </svg>
          <span>{fila.texto}</span>
        </div>
      ))}

      {/* El clic lo abre con el programa que le corresponda, no lo descarga:
          el archivo ya está en el disco del usuario.

          Uno que ya no está se muestra igual, apagado. La carpeta es del
          usuario y puede vaciarla; callarlo sería perder el dato de que
          existió. */}
      {detalle.adjuntos.map((adjunto) => (
        <button
          type="button"
          className={
            adjunto.existe ? "ficha-fila archivo" : "ficha-fila archivo falta"
          }
          key={adjunto.ruta}
          disabled={!adjunto.existe}
          onClick={() => void openPath(`${carpeta}/${adjunto.ruta}`)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <span>{adjunto.nombre_original}</span>
          <span className="peso">
            {adjunto.existe ? tamanoLegible(adjunto.tamano) : "ya no está"}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Una de las dos salidas de un evento repetido. */
