import { useEffect } from "react";

interface Props {
  /** Si cerrar la ventana deja la aplicación viva en la bandeja. */
  bandeja: boolean;
  /** Si el aviso de la bandeja todavía tiene que aparecer al cerrar. */
  avisar: boolean;
  /** Si es la ventana de arriba. Solo esa atiende Escape. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  /** Escribe una clave de la tabla `ajuste`. */
  onGuardar: (clave: string, valor: string) => void;
  onCerrar: () => void;
}

/**
 * Los ajustes de la aplicación.
 *
 * Por ahora solo la bandeja del sistema, que es lo que la etapa 14 puso en pie.
 * Apariencia y datos entran en la etapa 16, como secciones más de esta misma
 * lista.
 */
export function Ajustes({
  bandeja,
  avisar,
  activo,
  saliendo,
  onGuardar,
  onCerrar,
}: Props) {
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
          <div className="seccion">BANDEJA DEL SISTEMA</div>

          <div className="ajuste">
            <div className="ajuste-que">
              <div className="ajuste-titulo">Seguir activa en la bandeja</div>
              <div className="ajuste-nota">
                Al cerrar la ventana, la aplicación sigue corriendo y el ícono
                avisa si hay recordatorios
              </div>
            </div>
            <button
              type="button"
              className={bandeja ? "sw on" : "sw"}
              onClick={() => onGuardar("bandeja", bandeja ? "0" : "1")}
            >
              <i />
            </button>
          </div>

          <div className="ajuste">
            <div className="ajuste-que">
              <div className="ajuste-titulo">Explicar al cerrar la ventana</div>
              <div className="ajuste-nota">
                Vuelve a mostrar el aviso que recuerda que la aplicación sigue
                viva y dónde está el botón de salir
              </div>
            </div>
            <button
              type="button"
              className={avisar ? "sw on" : "sw"}
              onClick={() =>
                onGuardar("aviso_bandeja_visto", avisar ? "1" : "0")
              }
            >
              <i />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
