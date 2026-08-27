import { useEffect, useState } from "react";

interface Props {
  /** Si es la ventana de arriba. Solo esa atiende Escape. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  /** Esconder la ventana. `noRepetir` dice si el aviso queda dado por visto. */
  onEntendido: (noRepetir: boolean) => void;
  /** Lo mismo, pero dejando los ajustes abiertos detrás. */
  onAbrirAjustes: (noRepetir: boolean) => void;
}

/**
 * Lo que explica, la primera vez, que cerrar la ventana no cierra la aplicación.
 *
 * Aparece justo cuando la aplicación hizo algo inesperado, que es el momento en
 * que la explicación sirve y el mejor momento para ofrecer el ajuste que lo
 * cambia.
 *
 * La casilla nace marcada: el aviso está pensado para verse una sola vez, y
 * desmarcarla es pedir verlo de nuevo.
 */
export function AvisoBandeja({
  activo,
  saliendo,
  onEntendido,
  onAbrirAjustes,
}: Props) {
  const [noRepetir, setNoRepetir] = useState(true);

  // Escape hace lo mismo que Entendido: es el botón que ya tiene el foco, y
  // dejar la tecla muerta obliga al mouse para salir de un aviso informativo.
  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape" && activo) onEntendido(noRepetir);
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  });

  return (
    <div className={saliendo ? "velo saliendo" : "velo"}>
      <div className="modal angosto">
        <div className="modal-cab">
          <h2>La aplicación sigue abierta</h2>
        </div>

        <div className="modal-cuerpo apilado">
          <p className="parrafo">
            Cerraste la ventana, pero el calendario sigue corriendo en la bandeja
            del sistema para poder avisarte de tus recordatorios.
          </p>
          <p className="parrafo">
            Para cerrarlo del todo, haz clic derecho en el ícono de la bandeja y
            elige Salir.
          </p>
          <p className="parrafo">
            Si prefieres que cerrar la ventana cierre la aplicación, puedes
            cambiarlo en los ajustes.
          </p>

          <button
            type="button"
            className="casilla"
            onClick={() => setNoRepetir(!noRepetir)}
          >
            <span className={noRepetir ? "caja marcada" : "caja"} />
            No volver a mostrar este aviso
          </button>
        </div>

        <div className="modal-pie entre">
          <button
            type="button"
            className="btn"
            onClick={() => onAbrirAjustes(noRepetir)}
          >
            Abrir ajustes
          </button>
          <button
            type="button"
            className="btn pri"
            autoFocus
            onClick={() => onEntendido(noRepetir)}
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}
