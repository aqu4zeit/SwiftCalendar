import { useEffect, useRef, useState } from "react";

import {
  borrarNotificacion,
  borrarNotificacionesVistas,
  listarNotificaciones,
  marcarTodasVistas,
  marcarVista,
  type Aviso,
  type Grupos,
} from "./api";
import { fechaCompacta, fechaDe, horaDe, type FormatoHora } from "./fecha";
import { useListaConSalida } from "./presencia";

interface Props {
  grupos: Grupos;
  formatoHora: FormatoHora;
  /** Sube cuando algo cambió y hay que releer la lista. */
  version: number;
  /** Verdadero mientras el panel se va, para que alcance a animarse. */
  saliendo: boolean;
  onCambio: () => void;
  onAbrirEvento: (evento_id: number, ocurrencia: string) => void;
  onError: (mensaje: string) => void;
  onCerrar: () => void;
}

/**
 * Las notificaciones, pendientes arriba e historial abajo.
 *
 * Las dos secciones son la misma tabla separada por su estado, así que se piden
 * juntas y se reparten acá. Marcarlas como vistas no borra nada: una notificación
 * es un registro, no un aviso que pasa.
 */
export function PanelAvisos({
  grupos,
  formatoHora,
  version,
  saliendo,
  onCambio,
  onAbrirEvento,
  onError,
  onCerrar,
}: Props) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [preguntando, setPreguntando] = useState(false);
  const caja = useRef<HTMLElement>(null);

  useEffect(() => {
    let vigente = true;

    listarNotificaciones()
      .then((lista) => vigente && setAvisos(lista))
      .catch((e: unknown) => vigente && onError(String(e)));

    return () => {
      vigente = false;
    };
    // `onError` se recrea en cada render; lo que manda es la versión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  // Se cierra al clicar fuera. El botón que lo abre queda excluido porque su
  // propio clic ya alterna el panel: cerrarlo dos veces lo reabriría.
  useEffect(() => {
    function fuera(e: MouseEvent) {
      // Con la confirmación abierta el panel no se cierra: el diálogo vive fuera
      // de él, y cerrarlo dejaría la pregunta huérfana.
      if (preguntando) return;

      const destino = e.target as Node;
      if (caja.current?.contains(destino)) return;
      if (caja.current?.parentElement?.contains(destino)) return;
      onCerrar();
    }

    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [onCerrar, preguntando]);

  const pendientes = avisos.filter((a) => !a.vista);
  const vistas = avisos.filter((a) => a.vista);

  async function marcar(id: number) {
    try {
      await marcarVista(id);
      onCambio();
    } catch (e: unknown) {
      onError(String(e));
    }
  }

  async function marcarTodas() {
    try {
      await marcarTodasVistas();
      onCambio();
    } catch (e: unknown) {
      onError(String(e));
    }
  }

  async function borrar(id: number) {
    try {
      await borrarNotificacion(id);
      onCambio();
    } catch (e: unknown) {
      onError(String(e));
    }
  }

  async function borrarTodasLasVistas() {
    try {
      await borrarNotificacionesVistas();
      setPreguntando(false);
      onCambio();
    } catch (e: unknown) {
      onError(String(e));
    }
  }

  return (
    <>
      <aside
        ref={caja}
        className={saliendo ? "panel-avisos saliendo" : "panel-avisos"}
      >
        <div className="avisos-cab">
          <h2>Notificaciones</h2>

          {/* Marcar todas mientras queden pendientes; cuando no quedan, lo que
            tiene sentido es vaciar el historial. Nunca los dos a la vez: la
            cabecera es angosta y el segundo empujaría al primero. */}
          {pendientes.length > 0 ? (
            <button type="button" className="avisos-link" onClick={marcarTodas}>
              Marcar todas como vistas
            </button>
          ) : (
            vistas.length > 0 && (
              <button
                type="button"
                className="avisos-link"
                onClick={() => setPreguntando(true)}
              >
                Borrar las vistas
              </button>
            )
          )}
        </div>

        {avisos.length === 0 ? (
          <p className="avisos-vacio">No hay notificaciones todavía.</p>
        ) : (
          <div className="avisos-lista">
            {pendientes.length > 0 && (
              <Seccion
                titulo={`${pendientes.length} ${
                  pendientes.length === 1 ? "PENDIENTE" : "PENDIENTES"
                }`}
                avisos={pendientes}
                grupos={grupos}
                formatoHora={formatoHora}
                onMarcar={marcar}
                onAbrirEvento={onAbrirEvento}
              />
            )}

            {vistas.length > 0 && (
              <Seccion
                titulo="VISTAS ANTES"
                avisos={vistas}
                grupos={grupos}
                formatoHora={formatoHora}
                onBorrar={borrar}
                onAbrirEvento={onAbrirEvento}
              />
            )}
          </div>
        )}
      </aside>

      {/* Fuera del panel: el panel recorta lo que se sale de sus bordes, y esto
          cubre la ventana entera. */}
      {preguntando && (
        <div className="velo interno" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal angosto">
            <div className="modal-cab">
              <h2>¿Borrar las notificaciones vistas?</h2>
            </div>

            <div className="modal-cuerpo">
              <p className="parrafo">
                Se van a borrar {vistas.length}{" "}
                {vistas.length === 1 ? "notificación" : "notificaciones"} del
                historial. Los eventos no se tocan.
              </p>
            </div>

            <div className="modal-pie">
              <button
                type="button"
                className="btn"
                onClick={() => setPreguntando(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn malo"
                onClick={borrarTodasLasVistas}
              >
                Borrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Seccion({
  titulo,
  avisos,
  grupos,
  formatoHora,
  onMarcar,
  onBorrar,
  onAbrirEvento,
}: {
  titulo: string;
  avisos: Aviso[];
  grupos: Grupos;
  formatoHora: FormatoHora;
  /** Sin esto la fila no lleva el visto bueno: una vista ya no se marca. */
  onMarcar?: (id: number) => void;
  /** Solo las vistas se pueden borrar, así que solo ellas lo reciben. */
  onBorrar?: (id: number) => void;
  onAbrirEvento: (evento_id: number, ocurrencia: string) => void;
}) {
  // Una que se marca como vista no desaparece: cambia de sección. Sin la salida
  // el salto entre las dos listas se lee como si se hubiera borrado.
  const dibujados = useListaConSalida(avisos, (a) => String(a.id));

  return (
    <>
      <div className="avisos-sec">{titulo}</div>

      {dibujados.map(({ item: aviso, saliendo }) => (
        <div
          className={
            saliendo ? "aviso saliendo" : onMarcar ? "aviso" : "aviso vista"
          }
          key={aviso.id}
        >
          {/* El cuerpo abre el evento sin descartar la notificación: mirar qué
              era no es lo mismo que darla por atendida. */}
          <button
            type="button"
            className="aviso-cuerpo"
            onClick={() => onAbrirEvento(aviso.evento_id, aviso.ocurrencia)}
          >
            <span
              className="dot"
              style={{ background: color(grupos, aviso.grupo_id) }}
            />
            <span className="aviso-txt">
              <span className="t">{aviso.titulo}</span>
              <span className="h">{cuando(aviso, formatoHora)}</span>
            </span>
          </button>

          {/* Mismo sitio, distinta acción según el estado: la pendiente se
              marca, la vista se borra. Una sola no pregunta —es una fila— y
              vaciar el historial entero sí. */}
          {onMarcar && (
            <button
              type="button"
              className="aviso-ok"
              onClick={() => onMarcar(aviso.id)}
              title="Marcar como vista"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12l6 6L20 6" />
              </svg>
            </button>
          )}

          {onBorrar && (
            <button
              type="button"
              className="aviso-ok borrar"
              onClick={() => onBorrar(aviso.id)}
              title="Borrar esta notificación"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>
      ))}
    </>
  );
}

function color(grupos: Grupos, grupo_id: number): string {
  return grupos.todos.find((g) => g.id === grupo_id)?.color ?? "transparent";
}

/**
 * Cuándo era el evento, no cuándo apareció el aviso.
 *
 * Lo que el usuario quiere saber al leer la lista es a qué hora es la cosa; el
 * instante en que nació la notificación solo importa para ordenarlas.
 */
function cuando(aviso: Aviso, formato: FormatoHora): string {
  return `${fechaCompacta(fechaDe(aviso.ocurrencia))} · ${horaDe(aviso.ocurrencia, formato)}`;
}
