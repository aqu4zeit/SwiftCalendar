import { useEffect, useRef, useState } from "react";

import { MS_SALIDA } from "./presencia";

/**
 * Lo que se espera antes de mostrarlo.
 *
 * El de Windows tarda cerca de un segundo y no se puede ajustar: para cuando
 * aparece, uno ya movió el cursor. Este espera lo justo para no aparecer al
 * pasar de largo por encima de una fila de botones.
 */
const ESPERA = 350;

/** La separación entre el globo y lo que describe. */
const AIRE = 7;

/** La mitad del ancho máximo, para no salirse por los costados. */
const MEDIO = 130;

interface Globito {
  texto: string;
  /** El centro horizontal del elemento y el borde por el que sale. */
  x: number;
  y: number;
  /** Falso cuando no cabía arriba y tuvo que salir por abajo. */
  arriba: boolean;
}

/**
 * El texto que explica un botón, dibujado por nosotros.
 *
 * Es la misma familia que el desplegable y el selector de color: lo del sistema
 * lo dibuja Windows, siempre en claro y con su propio retraso. La diferencia es
 * que este vive dentro de nuestra ventana, así que basta un elemento y CSS.
 *
 * Se monta una sola vez y escucha en el documento, en vez de envolver cada
 * botón. Un componente por botón obligaría a tocar dieciséis sitios y a que cada
 * uno recordara su propio estado; acá el único que sabe de globos es este.
 */
export function Globo() {
  const [globo, setGlobo] = useState<Globito | null>(null);
  const [saliendo, setSaliendo] = useState(false);
  const espera = useRef<number | null>(null);

  /*
   * Sobre qué elemento estamos.
   *
   * `pointerover` se dispara otra vez al entrar a cada hijo —el `svg` de un
   * ícono, su `path`—, y sin esto cada movimiento dentro del mismo botón
   * reiniciaba la espera: el globo no aparecía nunca mientras el cursor se
   * moviera.
   */
  const sobre = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function cancelar() {
      if (espera.current !== null) window.clearTimeout(espera.current);
      espera.current = null;
    }

    function esconder() {
      cancelar();
      sobre.current = null;
      setGlobo((actual) => {
        if (actual !== null) setSaliendo(true);
        return actual;
      });
    }

    function mostrar(nodo: HTMLElement, texto: string) {
      const caja = nodo.getBoundingClientRect();

      // Sale por arriba salvo que no quepa, que es lo que pasa con los botones
      // de la barra superior.
      const arriba = caja.top >= 44;

      setSaliendo(false);
      setGlobo({
        texto,
        x: Math.min(
          Math.max(caja.left + caja.width / 2, MEDIO + 4),
          window.innerWidth - MEDIO - 4,
        ),
        y: arriba ? caja.top - AIRE : caja.bottom + AIRE,
        arriba,
      });
    }

    function entrar(evento: Event) {
      const destino = evento.target;
      if (!(destino instanceof Element)) return;

      const nodo = destino.closest<HTMLElement>("[data-texto]");
      const texto = nodo?.dataset.texto;
      if (!nodo || !texto) {
        esconder();
        return;
      }

      // Seguimos sobre el mismo botón: la espera que ya empezó sigue corriendo.
      if (sobre.current === nodo) return;

      cancelar();
      sobre.current = nodo;
      espera.current = window.setTimeout(() => mostrar(nodo, texto), ESPERA);
    }

    // Un clic ya dijo lo que el globo iba a explicar, así que sobra.
    document.addEventListener("pointerover", entrar);
    document.addEventListener("pointerdown", esconder);
    document.addEventListener("focusin", entrar);
    document.addEventListener("focusout", esconder);
    // La posición se calcula una vez: si algo se mueve deja de valer.
    window.addEventListener("scroll", esconder, true);
    window.addEventListener("resize", esconder);

    return () => {
      cancelar();
      document.removeEventListener("pointerover", entrar);
      document.removeEventListener("pointerdown", esconder);
      document.removeEventListener("focusin", entrar);
      document.removeEventListener("focusout", esconder);
      window.removeEventListener("scroll", esconder, true);
      window.removeEventListener("resize", esconder);
    };
  }, []);

  // El globo sobrevive a su cierre lo que dura la animación, igual que las
  // ventanas. Sin esto desaparece de golpe.
  useEffect(() => {
    if (!saliendo) return;

    const temporizador = setTimeout(() => {
      setGlobo(null);
      setSaliendo(false);
    }, MS_SALIDA);

    return () => clearTimeout(temporizador);
  }, [saliendo]);

  if (!globo) return null;

  return (
    <div
      className={saliendo ? "globo saliendo" : "globo"}
      data-arriba={globo.arriba}
      style={{ left: globo.x, top: globo.y }}
      role="tooltip"
    >
      {globo.texto}
    </div>
  );
}
