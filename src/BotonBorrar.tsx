interface Props {
  onBorrar: () => void;
}

/** La cruz que vacía un campo de un clic. */
export function BotonBorrar({ onBorrar }: Props) {
  return (
    <button
      type="button"
      className="borrar-campo"
      onClick={onBorrar}
      data-globo aria-label="Vaciar"
    >
      <span className="gesto gesto-aspa" aria-hidden="true">✕</span>
    </button>
  );
}
