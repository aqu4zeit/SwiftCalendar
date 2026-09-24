interface Props {
  texto: string;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  onDeshacer: () => void;
}

/**
 * "Se borró «…» · Deshacer", abajo al centro, después de borrar.
 *
 * Todo lo que se borra vuelve con Ctrl+Z, pero eso solo lo decía el texto de
 * la confirmación: quien no lo leyó no sabía que había red. El botón hace lo
 * mismo que Ctrl+Z, sin un camino propio. Cuánto dura y cuándo se va lo decide
 * App, que es quien sabe si pasó algo más que Deshacer ya no desharía.
 */
export function AvisoDeshacer({ texto, saliendo, onDeshacer }: Props) {
  return (
    <div className="aviso-deshacer-caja">
      <div
        className={saliendo ? "aviso-deshacer saliendo" : "aviso-deshacer"}
        role="status"
      >
        <span className="aviso-deshacer-texto">{texto}</span>
        <button
          type="button"
          className="btn"
          onClick={onDeshacer}
          aria-keyshortcuts="Control+Z"
          disabled={saliendo}
        >
          Deshacer
        </button>
      </div>
    </div>
  );
}
