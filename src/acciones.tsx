import { save } from "@tauri-apps/plugin-dialog";

import {
  exportarEvento,
  type Edicion,
  type EventoDetalle,
  type Instancia,
} from "./api";
import { fechaCompacta, fechaDe } from "./fecha";
import { desdeRrule, textoRepeticion } from "./rrule";

/**
 * Lo que se hace con un evento, en un solo lugar.
 *
 * Vive aparte porque hay dos sitios que lo piden: la ficha y el menú del clic
 * derecho. Con una copia en cada uno, "solo esta o todas" acabaría contestándose
 * distinto según por dónde entraras.
 */

/** Qué alcance tiene la acción sobre un evento que se repite. */
export type Alcance = "solo_esta" | "todas";

/**
 * `null` toca la fila completa; la fecha de la ocurrencia toca solo esa.
 *
 * Un evento sin regla no tiene ocurrencias sueltas que separar, así que el
 * alcance no significa nada y siempre se toca la fila.
 */
export function ocurrenciaSegun(
  instancia: Instancia,
  esSerie: boolean,
  elegido: Alcance,
): string | null {
  if (!esSerie || elegido === "todas") return null;
  return instancia.ocurrencia;
}

/**
 * Con qué abre el formulario al editar.
 *
 * Toda la serie se edita sobre la fila maestra, con sus propias fechas: guardar
 * la fecha de la ocurrencia sobre la serie completa la correría entera.
 */
export function edicionSegun(
  detalle: EventoDetalle,
  instancia: Instancia,
  esSerie: boolean,
  elegido: Alcance,
): Edicion {
  const deLaSerie = elegido === "todas";

  return {
    detalle,
    ocurrencia: ocurrenciaSegun(instancia, esSerie, elegido),
    inicio: deLaSerie ? detalle.inicio : instancia.inicio,
    fin: deLaSerie ? detalle.fin : instancia.fin,
  };
}

/**
 * Guarda el evento como archivo `.calev`.
 *
 * El diálogo entrega la ruta y el lado nativo escribe: la interfaz nunca toca
 * bytes, igual que con las imágenes y los adjuntos. Cancelar no es un error.
 */
export async function exportarAArchivo(detalle: EventoDetalle): Promise<void> {
  const ruta = await save({
    defaultPath: `${detalle.titulo.trim() || "evento"}.calev`,
    filters: [{ name: "Evento de SwiftCalendar", extensions: ["calev"] }],
  });

  if (ruta !== null) await exportarEvento(detalle.id, ruta);
}

/** Una de las dos opciones de alcance. */
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

/**
 * La pregunta previa a editar o borrar.
 *
 * Sirve a los dos casos: un evento que se repite pregunta el alcance, y uno
 * suelto que se va a borrar pide confirmación. Es la misma ventana porque es el
 * mismo momento —justo antes de tocar algo— y separarlas dejaría dos sitios
 * decidiendo cómo se pregunta.
 */
export function PreguntaAlcance({
  accion,
  detalle,
  instancia,
  esSerie,
  alcance,
  ocupado,
  onAlcance,
  onCancelar,
  onSeguir,
}: {
  accion: "editar" | "borrar";
  detalle: EventoDetalle | null;
  instancia: Instancia;
  esSerie: boolean;
  alcance: Alcance;
  /** Deshabilita el botón mientras la acción está en curso. */
  ocupado: boolean;
  onAlcance: (alcance: Alcance) => void;
  onCancelar: () => void;
  onSeguir: () => void;
}) {
  const verbo = accion === "borrar" ? "Borra" : "Cambia";

  return (
    <div className="velo interno" onClick={(e) => e.stopPropagation()}>
      <div className="modal angosto">
        <div className="modal-cab">
          <h2>{esSerie ? "Este evento se repite" : "¿Borrar este evento?"}</h2>
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
                onElegir={() => onAlcance("solo_esta")}
                titulo="Solo esta"
                detalle={`${verbo} únicamente el ${fechaCompacta(
                  fechaDe(instancia.inicio),
                )}. El resto de la serie queda igual.`}
              />
              <Opcion
                elegida={alcance === "todas"}
                onElegir={() => onAlcance("todas")}
                titulo="Todas"
                detalle={`${verbo} toda la serie, incluidas las que ya pasaron.`}
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
          <button type="button" className="btn" onClick={onCancelar}>
            Cancelar
          </button>
          <button
            type="button"
            className={accion === "borrar" ? "btn malo" : "btn pri"}
            disabled={ocupado}
            onClick={onSeguir}
          >
            {accion === "borrar" ? "Borrar" : "Continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
