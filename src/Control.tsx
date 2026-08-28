import { useEffect, useState } from "react";

import {
  borrarEvento,
  borrarTodos,
  listarEventos,
  type Resumen,
} from "./api";
import {
  fechaCompacta,
  fechaDe,
  horaDe,
  mismoDia,
  rangoCompacto,
  type FormatoHora,
} from "./fecha";
import { useListaConSalida } from "./presencia";
import { desdeRrule, textoRepeticion } from "./rrule";

interface Props {
  formatoHora: FormatoHora;
  /** Si es la ventana de arriba. Solo esa atiende Escape. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  /** Algo se borró: el calendario tiene que volver a pedir el mes. */
  onCambio: () => void;
  onCerrar: () => void;
}

/** Qué está esperando confirmación: un evento concreto, o la lista entera. */
type Pregunta = { que: "uno"; evento: Resumen } | { que: "todos" };

/**
 * Todos los eventos guardados, para verlos y borrarlos desde un solo sitio.
 *
 * Lista lo que hay en la base y no lo que cae en un mes: una serie es una fila.
 * Por eso borrar acá se lleva la serie completa, y no hay alcance que preguntar
 * —no hay ninguna ocurrencia elegida—, solo la confirmación de siempre.
 */
export function Control({
  formatoHora,
  activo,
  saliendo,
  onCambio,
  onCerrar,
}: Props) {
  const [eventos, setEventos] = useState<Resumen[]>([]);
  const [preguntando, setPreguntando] = useState<Pregunta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Sube cada vez que esta ventana borra algo, para releer la lista.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let vigente = true;

    listarEventos()
      .then((lista) => vigente && setEventos(lista))
      .catch((e: unknown) => vigente && setError(String(e)));

    return () => {
      vigente = false;
    };
  }, [version]);

  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      // Con la confirmación abierta, Escape la cierra a ella y no la ventana.
      if (evento.key !== "Escape" || !activo) return;
      if (preguntando) return setPreguntando(null);
      onCerrar();
    }

    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  });

  async function confirmar() {
    if (!preguntando) return;
    setOcupado(true);

    try {
      if (preguntando.que === "todos") await borrarTodos();
      else await borrarEvento(preguntando.evento.evento_id, null);

      setPreguntando(null);
      setVersion((v) => v + 1);
      onCambio();
    } catch (e: unknown) {
      setError(String(e));
      setPreguntando(null);
    } finally {
      setOcupado(false);
    }
  }

  const dibujados = useListaConSalida(eventos, (e) => String(e.evento_id));

  return (
    <div className={saliendo ? "velo saliendo" : "velo"}>
      <div className="modal ancho">
        <div className="modal-cab">
          <h2>Todos los eventos</h2>
          <button type="button" className="cerrar" onClick={onCerrar}>
            ✕
          </button>
        </div>

        <div className="modal-cuerpo">
          {error && <div className="msg-error">{error}</div>}

          {/* Se pregunta por lo dibujado y no por la lista: los que se están
              yendo todavía ocupan su sitio, y con la lista ya vacía el mensaje
              los reemplazaría antes de que alcancen a animarse. */}
          {dibujados.length === 0 ? (
            <p className="parrafo">No hay eventos guardados.</p>
          ) : (
            <div className="control-lista">
              {dibujados.map(({ item: evento, saliendo: yendose }) => (
                <div
                  className={yendose ? "control-fila saliendo" : "control-fila"}
                  key={evento.evento_id}
                >
                  <span className="dot" style={{ background: evento.color }} />

                  <span className="control-txt">
                    <span className="t">{evento.titulo}</span>
                    <span className="h">{cuando(evento, formatoHora)}</span>
                  </span>

                  <span className="control-grupo">{evento.grupo}</span>

                  <button
                    type="button"
                    className="control-borrar"
                    onClick={() => setPreguntando({ que: "uno", evento })}
                    data-texto="Borrar este evento"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-pie entre">
          <span className="control-cuenta">
            {eventos.length} {eventos.length === 1 ? "evento" : "eventos"}
          </span>

          <button
            type="button"
            className={eventos.length === 0 ? "btn inactivo" : "btn malo"}
            disabled={eventos.length === 0}
            onClick={() => setPreguntando({ que: "todos" })}
          >
            Borrar todos
          </button>
        </div>
      </div>

      {preguntando && (
        <div className="velo interno">
          <div className="modal angosto">
            <div className="modal-cab">
              <h2>
                {preguntando.que === "todos"
                  ? "¿Borrar todos los eventos?"
                  : "¿Borrar este evento?"}
              </h2>
            </div>

            <div className="modal-cuerpo apilado">
              {preguntando.que === "todos" ? (
                <>
                  <p className="parrafo">
                    Se van a borrar los {eventos.length} eventos guardados, con
                    sus adjuntos y sus recordatorios. Los grupos quedan como
                    están.
                  </p>
                  {/* Ctrl+Z solo actúa con el calendario al frente: con una
                      ventana flotante abierta, los atajos no corren. */}
                  <p className="parrafo">
                    Es una sola acción: al cerrar esta ventana y Ajustes, Ctrl+Z
                    los devuelve todos de una vez.
                  </p>
                </>
              ) : (
                <p className="parrafo">
                  {preguntando.evento.titulo},{" "}
                  {cuando(preguntando.evento, formatoHora)}.
                  {preguntando.evento.rrule !== null &&
                    " Se borra la serie completa, incluidas las que ya pasaron."}
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
                className="btn malo"
                disabled={ocupado}
                onClick={() => void confirmar()}
              >
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Cuándo empieza el evento y, si se repite, cada cuánto vuelve. */
function cuando(evento: Resumen, formato: FormatoHora): string {
  const inicio = fechaDe(evento.inicio);
  const fin = evento.fin === null ? null : fechaDe(evento.fin);

  const partes: string[] = [
    fin && !mismoDia(inicio, fin)
      ? rangoCompacto(inicio, fin)
      : fechaCompacta(inicio),
  ];

  if (!evento.todo_el_dia) partes.push(horaDe(evento.inicio, formato));
  if (evento.rrule !== null) {
    partes.push(`se repite ${textoRepeticion(desdeRrule(evento.rrule))}`);
  }

  return partes.join(" · ");
}
