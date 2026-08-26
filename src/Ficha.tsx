import { useEffect, useState, type ReactNode } from "react";

import {
  borrarEvento,
  leerEvento,
  type Edicion,
  type EventoDetalle,
  type Grupos,
  type Instancia,
} from "./api";
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

interface Props {
  instancia: Instancia;
  grupos: Grupos;
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
type Alcance = "solo_esta" | "todas";

export function Ficha({
  instancia,
  grupos,
  formatoHora,
  activo,
  saliendo,
  onCerrar,
  onEditar,
  onBorrado,
}: Props) {
  const [detalle, setDetalle] = useState<EventoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Qué acción está esperando que se elija el alcance, o la confirmación.
  const [preguntando, setPreguntando] = useState<"editar" | "borrar" | null>(
    null,
  );
  const [alcance, setAlcance] = useState<Alcance>("solo_esta");
  const [borrando, setBorrando] = useState(false);

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
  const esSerie = detalle?.rrule != null;

  /**
   * `null` toca la fila completa; la fecha de la ocurrencia toca solo esa.
   *
   * Un evento sin regla no tiene ocurrencias sueltas que separar, así que el
   * alcance no significa nada y siempre se toca la fila. Preguntarlo acá evita
   * que cada sitio que llama tenga que acordarse.
   */
  function ocurrenciaSegun(elegido: Alcance): string | null {
    if (!esSerie || elegido === "todas") return null;
    return instancia.ocurrencia;
  }

  function editar(elegido: Alcance) {
    if (!detalle) return;

    // Toda la serie se edita sobre la fila maestra, con sus propias fechas.
    const deLaSerie = elegido === "todas";

    onEditar({
      detalle,
      ocurrencia: ocurrenciaSegun(elegido),
      inicio: deLaSerie ? detalle.inicio : instancia.inicio,
      fin: deLaSerie ? detalle.fin : instancia.fin,
    });
  }

  async function borrar(elegido: Alcance) {
    setBorrando(true);
    try {
      await borrarEvento(instancia.evento_id, ocurrenciaSegun(elegido));
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

  return (
    <div
      className={saliendo ? "velo saliendo" : "velo"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="ficha">
        <div className="ficha-cab">
          <button type="button" className="cerrar" onClick={onCerrar}>
            ✕
          </button>
        </div>

        {error && <div className="msg-error ficha-error">{error}</div>}

        {detalle && (
          <>
            <div className="ficha-cuerpo">
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

              {detalle.descripcion && (
                <p className="ficha-desc">{detalle.descripcion}</p>
              )}

              <Detalles detalle={detalle} />
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
        <div className="velo interno" onClick={(e) => e.stopPropagation()}>
          <div className="modal angosto">
            <div className="modal-cab">
              <h2>
                {esSerie
                  ? "Este evento se repite"
                  : "¿Borrar este evento?"}
              </h2>
            </div>

            <div className="modal-cuerpo">
              {esSerie ? (
                <>
                  <p className="parrafo">
                    {detalle?.titulo} se repite{" "}
                    {textoRepeticion(desdeRrule(detalle?.rrule ?? ""))}.
                  </p>

                  <Opcion
                    elegida={alcance === "solo_esta"}
                    onElegir={() => setAlcance("solo_esta")}
                    titulo="Solo esta"
                    detalle={`${
                      preguntando === "borrar" ? "Borra" : "Cambia"
                    } únicamente el ${fechaCompacta(
                      fechaDe(instancia.inicio),
                    )}. El resto de la serie queda igual.`}
                  />
                  <Opcion
                    elegida={alcance === "todas"}
                    onElegir={() => setAlcance("todas")}
                    titulo="Todas"
                    detalle={`${
                      preguntando === "borrar" ? "Borra" : "Cambia"
                    } toda la serie, incluidas las que ya pasaron.`}
                  />
                </>
              ) : (
                <p className="parrafo">
                  {detalle?.titulo}, {fechaCompacta(fechaDe(instancia.inicio))}.
                  Esta acción no se puede deshacer desde acá.
                </p>
              )}
            </div>

            <div className="modal-pie">
              <button
                type="button"
                className="btn"
                onClick={() => setPreguntando(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className={
                  preguntando === "borrar" ? "btn malo" : "btn pri"
                }
                disabled={borrando}
                onClick={() =>
                  preguntando === "borrar" ? borrar(alcance) : editar(alcance)
                }
              >
                {preguntando === "borrar" ? "Borrar" : "Continuar"}
              </button>
            </div>
          </div>
        </div>
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
function Detalles({ detalle }: { detalle: EventoDetalle }) {
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

  if (filas.length === 0) return null;

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
    </div>
  );
}

/** Una de las dos salidas de un evento repetido. */
function Opcion({
  elegida,
  onElegir,
  titulo,
  detalle,
}: {
  elegida: boolean;
  onElegir: () => void;
  titulo: string;
  detalle: string;
}) {
  return (
    <button
      type="button"
      className={elegida ? "opcion on" : "opcion"}
      onClick={onElegir}
    >
      <span className="radio" />
      <span>
        <span className="opcion-t">{titulo}</span>
        <span className="opcion-s">{detalle}</span>
      </span>
    </button>
  );
}
