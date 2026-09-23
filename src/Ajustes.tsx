import { useEffect, useId, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { open, save } from "@tauri-apps/plugin-dialog";

import { exportarRespaldo, restaurarRespaldo } from "./api";
import type { Densidad } from "./api";
import type { FormatoHora } from "./fecha";
import { usePresencia } from "./presencia";

interface Props {
  densidad: Densidad;
  formatoHora: FormatoHora;
  /** Si cerrar la ventana deja la aplicación viva en la bandeja. */
  bandeja: boolean;
  /** Si el aviso de la bandeja todavía tiene que aparecer al cerrar. */
  avisar: boolean;
  /** Si la aplicación se registra para abrirse al iniciar sesión. */
  arranque: boolean;
  /** La carpeta de datos, en absoluto. */
  carpeta: string;
  /** Si es la ventana de arriba. Solo esa atiende Escape. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  /** Escribe una clave de la tabla `ajuste`. */
  onGuardar: (clave: string, valor: string) => void;
  /** Abre la lista de todos los eventos, encima de esta ventana. */
  onAbrirControl: () => void;
  onCerrar: () => void;
}

/** Los ids del texto de una fila, para que su control se nombre con él. */
interface IdsFila {
  titulo: string;
  nota: string | undefined;
  /** El título y la nota juntos: describen un botón que ya tiene su texto. */
  descripcion: string;
}

/**
 * Una fila de ajuste: qué es a la izquierda, con qué se cambia a la derecha.
 *
 * El control recibe los ids del texto de la fila. Sin ellos el lector de
 * pantalla anunciaba un interruptor sin decir qué enciende, y dos botones
 * "Abrir" sin decir qué abre cada uno.
 */
function Fila({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota?: string;
  children: (ids: IdsFila) => React.ReactNode;
}) {
  const id = useId();
  const ids: IdsFila = {
    titulo: `${id}-titulo`,
    nota: nota ? `${id}-nota` : undefined,
    descripcion: nota ? `${id}-titulo ${id}-nota` : `${id}-titulo`,
  };

  return (
    <div className="ajuste">
      <div className="ajuste-que">
        <div className="ajuste-titulo" id={ids.titulo}>
          {titulo}
        </div>
        {nota && (
          <div className="ajuste-nota" id={ids.nota}>
            {nota}
          </div>
        )}
      </div>
      {children(ids)}
    </div>
  );
}

/** El interruptor de sí o no, que es el control más repetido de esta pantalla. */
function Sw({
  on,
  onCambiar,
  ids,
}: {
  on: boolean;
  onCambiar: () => void;
  ids: IdsFila;
}) {
  return (
    <button
      type="button"
      className={on ? "sw on" : "sw"}
      role="switch"
      aria-checked={on}
      aria-labelledby={ids.titulo}
      aria-describedby={ids.nota}
      onClick={onCambiar}
    >
      <i />
    </button>
  );
}

/**
 * Los ajustes de la aplicación.
 *
 * Nació en la etapa 14 con la sección de bandeja, que era lo único que había.
 * La 16 le agregó Apariencia y Datos como secciones más de la misma lista, sin
 * tocar la que ya estaba: era el plan desde el principio.
 */
export function Ajustes({
  densidad,
  formatoHora,
  bandeja,
  avisar,
  arranque,
  carpeta,
  activo,
  saliendo,
  onGuardar,
  onAbrirControl,
  onCerrar,
}: Props) {
  // Enlaza la ventana y su confirmación con sus títulos.
  const id = useId();
  const [confirmando, setConfirmando] = useState<string | null>(null);
  // La ruta sigue dibujada mientras la confirmación se va.
  const { valor: aRestaurar, saliendo: restaurarSaliendo } =
    usePresencia(confirmando);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function exportar() {
    setOcupado(true);
    try {
      const ruta = await save({
        defaultPath: "SwiftCalendar.respaldo.zip",
        filters: [{ name: "Respaldo de SwiftCalendar", extensions: ["zip"] }],
      });
      if (ruta !== null) await exportarRespaldo(ruta);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function elegirParaRestaurar() {
    try {
      const ruta = await open({
        multiple: false,
        filters: [{ name: "Respaldo de SwiftCalendar", extensions: ["zip"] }],
      });
      // Se pregunta después de elegir y no antes: confirmar en el vacío, sin
      // saber qué archivo, es una confirmación que nadie lee.
      if (typeof ruta === "string") setConfirmando(ruta);
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape" && activo) onCerrar();
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  });

  return (
    <div className={saliendo ? "velo saliendo" : "velo"}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
      >
        <div className="modal-cab">
          <h2 id={`${id}-titulo`}>Ajustes</h2>
          <button type="button" className="cerrar" aria-label="Cerrar" onClick={onCerrar}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="modal-cuerpo apilado">
          <div className="seccion">APARIENCIA</div>

          <Fila
            titulo="Densidad de la celda"
            nota="Cuánto espacio ocupa cada evento en la vista mes"
          >
            {(ids) => (
              <div
                className="segmentado"
                role="group"
                aria-labelledby={ids.titulo}
                aria-describedby={ids.nota}
              >
                <button
                  type="button"
                  className={densidad === "comoda" ? "on" : undefined}
                  aria-pressed={densidad === "comoda"}
                  onClick={() => onGuardar("densidad", "comoda")}
                >
                  Cómoda
                </button>
                <button
                  type="button"
                  className={densidad === "compacta" ? "on" : undefined}
                  aria-pressed={densidad === "compacta"}
                  onClick={() => onGuardar("densidad", "compacta")}
                >
                  Compacta
                </button>
              </div>
            )}
          </Fila>

          <Fila titulo="Formato de hora">
            {(ids) => (
              <div
                className="segmentado"
                role="group"
                aria-labelledby={ids.titulo}
              >
                <button
                  type="button"
                  className={formatoHora === "24" ? "on" : undefined}
                  aria-pressed={formatoHora === "24"}
                  onClick={() => onGuardar("formato_hora", "24")}
                >
                  24 h
                </button>
                <button
                  type="button"
                  className={formatoHora === "12" ? "on" : undefined}
                  aria-pressed={formatoHora === "12"}
                  onClick={() => onGuardar("formato_hora", "12")}
                >
                  12 h
                </button>
              </div>
            )}
          </Fila>

          <div className="seccion">BANDEJA DEL SISTEMA</div>

          <Fila
            titulo="Seguir activa en la bandeja"
            nota="Al cerrar la ventana, la aplicación sigue corriendo y el ícono avisa si hay notificaciones. Apagado, cerrar la ventana cierra la aplicación"
          >
            {(ids) => (
              <Sw
                ids={ids}
                on={bandeja}
                onCambiar={() => onGuardar("bandeja", bandeja ? "0" : "1")}
              />
            )}
          </Fila>

          <Fila
            titulo="Explicar al cerrar la ventana"
            nota="Vuelve a mostrar el aviso que recuerda que la aplicación sigue viva y dónde está el botón de salir"
          >
            {(ids) => (
              <Sw
                ids={ids}
                on={avisar}
                onCambiar={() =>
                  onGuardar("aviso_bandeja_visto", avisar ? "1" : "0")
                }
              />
            )}
          </Fila>

          <Fila
            titulo="Arrancar junto con Windows"
            nota="Se abre directamente en la bandeja, sin mostrar la ventana"
          >
            {(ids) => (
              <Sw
                ids={ids}
                on={arranque}
                onCambiar={() => onGuardar("arranque", arranque ? "0" : "1")}
              />
            )}
          </Fila>

          <div className="seccion">EVENTOS</div>

          <Fila
            titulo="Todos los eventos"
            nota="Ver lo que hay guardado y borrar desde ahí"
          >
            {(ids) => (
              <button
                type="button"
                className="btn"
                aria-describedby={ids.descripcion}
                onClick={onAbrirControl}
              >
                Abrir
              </button>
            )}
          </Fila>

          <div className="seccion">DATOS</div>

          {error && (
            <div className="msg-error" role="alert">
              {error}
            </div>
          )}

          <Fila titulo="Carpeta de datos">
            {(ids) => (
              <button
                type="button"
                className="btn"
                aria-describedby={ids.descripcion}
                onClick={() => void openPath(carpeta).catch(() => {})}
              >
                Abrir
              </button>
            )}
          </Fila>

          {/* La ruta va debajo y a lo ancho: es larga y en la columna derecha
              obligaría a cortarla justo donde importa, que es el final. */}
          <div className="ruta">{carpeta}</div>

          <Fila
            titulo="Exportar respaldo"
            nota="Empaqueta la carpeta completa en un solo archivo"
          >
            {(ids) => (
              <button
                type="button"
                className="btn"
                aria-describedby={ids.descripcion}
                disabled={ocupado}
                onClick={exportar}
              >
                Exportar
              </button>
            )}
          </Fila>

          <Fila
            titulo="Restaurar desde respaldo"
            nota="Reemplaza todo el contenido actual y reinicia la aplicación"
          >
            {(ids) => (
              <button
                type="button"
                className="btn"
                aria-describedby={ids.descripcion}
                onClick={elegirParaRestaurar}
              >
                Restaurar
              </button>
            )}
          </Fila>
        </div>
      </div>

      {aRestaurar !== null && (
        <div className={restaurarSaliendo ? "velo interno saliendo" : "velo interno"}>
          <div
            className="modal angosto"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${id}-restaurar`}
          >
            <div className="modal-cab">
              <h2 id={`${id}-restaurar`}>¿Restaurar este respaldo?</h2>
            </div>
            <div className="modal-cuerpo apilado">
              <p className="parrafo">
                Se reemplaza todo lo que hay ahora: eventos, grupos, imágenes y
                archivos. Lo actual no se puede recuperar después.
              </p>
              <p className="parrafo">
                La aplicación se reinicia sola y vuelve con los datos del
                respaldo puestos.
              </p>
              <div className="ruta">{aRestaurar}</div>
            </div>
            <div className="modal-pie">
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmando(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn malo"
                onClick={() => {
                  void restaurarRespaldo(aRestaurar).catch((e: unknown) => {
                    setError(String(e));
                    setConfirmando(null);
                  });
                }}
              >
                Restaurar y cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
