/**
 * Hace algo recién cuando el clic en curso terminó.
 *
 * Un campo que reclama al perder el foco ("El título es obligatorio") agrega
 * una línea y empuja todo lo de abajo. Si el foco se fue porque se apretó otro
 * control, ese empujón llegaba con el botón todavía apretado: se soltaba sobre
 * otra cosa, el clic caía en el contenedor y había que volver a hacerlo. Con el
 * formulario recién abierto le pasaba al primer clic en cualquier lado.
 *
 * Si no hay nada apretado —el foco se fue con el teclado— se hace en el acto.
 * Si lo hay, después del `pointerup` y en otra tarea: el `click` sale de esa
 * misma tanda de eventos, y dibujar antes todavía podía moverle el destino.
 */
export function alSoltarElPuntero(accion: () => void) {
  if (!document.documentElement.matches(":active")) {
    accion();
    return;
  }

  function soltar() {
    document.removeEventListener("pointerup", soltar, true);
    document.removeEventListener("pointercancel", soltar, true);
    setTimeout(accion, 0);
  }

  document.addEventListener("pointerup", soltar, true);
  document.addEventListener("pointercancel", soltar, true);
}
