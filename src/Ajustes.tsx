import { useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { open, save } from "@tauri-apps/plugin-dialog";

import { exportarRespaldo, restaurarRespaldo } from "./api";
import type { Densidad, Tema } from "./api";
import type { FormatoHora } from "./fecha";

interface Props {
  tema: Tema;
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
  onCerrar: () => void;
}

/** Una fila de ajuste: qué es a la izquierda, con qué se cambia a la derecha. */
function Fila({
  titulo,
  nota,
  children,
}: {
  titulo: string;
  nota?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ajuste">
      <div className="ajuste-que">
        <div className="ajuste-titulo">{titulo}</div>
        {nota && <div className="ajuste-nota">{nota}</div>}
      </div>
      {children}
    </div>
  );
}

/** El interruptor de sí o no, que es el control más repetido de esta pantalla. */
function Sw({ on, onCambiar }: { on: boolean; onCambiar: () => void }) {
  return (
    <button type="button" className={on ? "sw on" : "sw"} onClick={onCambiar}>
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
  tema,
  densidad,
  formatoHora,
  bandeja,
  avisar,
  arranque,
  carpeta,
  activo,
  saliendo,
  onGuardar,
  onCerrar,
}: Props) {
  const [confirmando, setConfirmando] = useState<string | null>(null);
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
      <div className="modal">
        <div className="modal-cab">
          <h2>Ajustes</h2>
          <button type="button" className="cerrar" onClick={onCerrar}>
            ✕
          </button>
        </div>

        <div className="modal-cuerpo apilado">
          <div className="seccion">APARIENCIA</div>

          <Fila titulo="Tema">
            <div className="segmentado">
              <button
                type="button"
                className={tema === "oscuro" ? "on" : undefined}
                onClick={() => onGuardar("tema", "oscuro")}
              >
                Oscuro
              </button>
              <button
                type="button"
                className={tema === "claro" ? "on" : undefined}
                onClick={() => onGuardar("tema", "claro")}
              >
                Claro
              </button>
            </div>
          </Fila>

          <Fila
            titulo="Densidad de la celda"
            nota="Cuánto espacio ocupa cada evento en la vista mes"
          >
            <div className="segmentado">
              <button
                type="button"
                className={densidad === "comoda" ? "on" : undefined}
                onClick={() => onGuardar("densidad", "comoda")}
              >
                Cómoda
              </button>
              <button
                type="button"
                className={densidad === "compacta" ? "on" : undefined}
                onClick={() => onGuardar("densidad", "compacta")}
              >
                Compacta
              </button>
            </div>
          </Fila>

          <Fila titulo="Formato de hora">
            <div className="segmentado">
              <button
                type="button"
                className={formatoHora === "24" ? "on" : undefined}
                onClick={() => onGuardar("formato_hora", "24")}
              >
                24 h
              </button>
              <button
                type="button"
                className={formatoHora === "12" ? "on" : undefined}
                onClick={() => onGuardar("formato_hora", "12")}
              >
                12 h
              </button>
            </div>
          </Fila>

          <div className="seccion">BANDEJA DEL SISTEMA</div>

          <Fila
            titulo="Seguir activa en la bandeja"
            nota="Al cerrar la ventana, la aplicación sigue corriendo y el ícono avisa si hay recordatorios. Apagado, cerrar la ventana cierra la aplicación"
          >
            <Sw
              on={bandeja}
              onCambiar={() => onGuardar("bandeja", bandeja ? "0" : "1")}
            />
          </Fila>

          <Fila
            titulo="Explicar al cerrar la ventana"
            nota="Vuelve a mostrar el aviso que recuerda que la aplicación sigue viva y dónde está el botón de salir"
          >
            <Sw
              on={avisar}
              onCambiar={() =>
                onGuardar("aviso_bandeja_visto", avisar ? "1" : "0")
              }
            />
          </Fila>

          <Fila
            titulo="Arrancar junto con Windows"
            nota="Se abre directamente en la bandeja, sin mostrar la ventana"
          >
            <Sw
              on={arranque}
              onCambiar={() => onGuardar("arranque", arranque ? "0" : "1")}
            />
          </Fila>

          <div className="seccion">DATOS</div>

          {error && <div className="msg-error">{error}</div>}

          <Fila titulo="Carpeta de datos">
            <button
              type="button"
              className="btn"
              onClick={() => void openPath(carpeta).catch(() => {})}
            >
              Abrir
            </button>
          </Fila>

          {/* La ruta va debajo y a lo ancho: es larga y en la columna derecha
              obligaría a cortarla justo donde importa, que es el final. */}
          <div className="ruta">{carpeta}</div>

          <Fila
            titulo="Exportar respaldo"
            nota="Empaqueta la carpeta completa en un solo archivo"
          >
            <button
              type="button"
              className="btn"
              disabled={ocupado}
              onClick={exportar}
            >
              Exportar
            </button>
          </Fila>

          <Fila
            titulo="Restaurar desde respaldo"
            nota="Reemplaza todo el contenido actual y reinicia la aplicación"
          >
            <button type="button" className="btn" onClick={elegirParaRestaurar}>
              Restaurar
            </button>
          </Fila>
        </div>
      </div>

      {confirmando !== null && (
        <div className="velo interno">
          <div className="modal angosto">
            <div className="modal-cab">
              <h2>¿Restaurar este respaldo?</h2>
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
              <div className="ruta">{confirmando}</div>
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
                  void restaurarRespaldo(confirmando).catch((e: unknown) => {
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
