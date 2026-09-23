/**
 * El más de crear, dibujado.
 *
 * Era el carácter "+" de la fuente, y en Segoe UI ese signo es chico (6 × 7 px
 * de tinta a 13 px), de trazo fino y cae entre 1,5 y 2 px por debajo del centro
 * de las minúsculas: junto a "Nuevo evento" se veía caído y apagado. Dibujado
 * mide lo que se le pide, lleva el trazo redondeado de los demás íconos y se
 * centra exacto, en una fila flexible o suelto en medio del texto.
 */
export function Mas({ className }: { className?: string }) {
  return (
    <svg
      className={className ? `mas-icono ${className}` : "mas-icono"}
      viewBox="0 0 10 10"
      aria-hidden="true"
    >
      <path d="M5 1v8M1 5h8" />
    </svg>
  );
}
