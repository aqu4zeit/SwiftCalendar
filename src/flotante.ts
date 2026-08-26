import { useEffect, useRef, useState } from "react";

/** Paneles que se abren sobre un campo sin quedar cortados. */
export interface Posicion {
  top: number;
  left: number;
  width: number;
}

const AIRE = 6;

/** Lo que tarda un panel en irse. Debe calzar con `estilos.css`. */
export const MS_SALIDA_PANEL = 110;

export function useFlotante(alto: number) {
  const ancla = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [posicion, setPosicion] = useState<Posicion | null>(null);
  const [saliendo, setSaliendo] = useState(false);

  // Un panel que se está yendo ya no cuenta como abierto: hacer clic en su
  // botón lo vuelve a abrir en vez de no hacer nada.
  const abierto = posicion !== null && !saliendo;

  function abrir() {
    setSaliendo(false);
    const nodo = ancla.current;
    if (!nodo) return;

    const caja = nodo.getBoundingClientRect();
    const cabeAbajo = window.innerHeight - caja.bottom >= alto + AIRE;
    const cabeArriba = caja.top >= alto + AIRE;

    setPosicion({
      top:
        cabeAbajo || !cabeArriba ? caja.bottom + AIRE : caja.top - alto - AIRE,
      left: caja.left,
      width: caja.width,
    });
  }

  function cerrar() {
    if (posicion === null) return;
    setSaliendo(true);
  }

  useEffect(() => {
    if (!saliendo) return;

    const temporizador = setTimeout(() => {
      setPosicion(null);
      setSaliendo(false);
    }, MS_SALIDA_PANEL);

    return () => clearTimeout(temporizador);
  }, [saliendo]);

  useEffect(() => {
    if (!abierto) return;

    // Fase de captura: llega antes que la ventana que contiene al panel, así
    // que Escape lo cierra a él y ahí se detiene. Sin esto la tecla cerraba
    // las dos cosas a la vez, o abría el aviso de descartar por detrás.
    function escape(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      evento.stopPropagation();
      cerrar();
    }

    document.addEventListener("keydown", escape, true);

    function fuera(evento: MouseEvent) {
      const destino = evento.target as Node;
      if (ancla.current?.contains(destino)) return;
      if (panel.current?.contains(destino)) return;
      cerrar();
    }

    // Al scrollear o cambiar el tamaño, la coordenada calculada deja de valer.
    // El scroll dentro del propio panel no mueve nada, así que no cuenta.
    function mover(evento: Event) {
      if (panel.current?.contains(evento.target as Node)) return;
      cerrar();
    }

    document.addEventListener("mousedown", fuera);
    window.addEventListener("scroll", mover, true);
    window.addEventListener("resize", mover);
    return () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("mousedown", fuera);
      window.removeEventListener("scroll", mover, true);
      window.removeEventListener("resize", mover);
    };
  }, [abierto]);

  return { ancla, panel, posicion, abierto, saliendo, abrir, cerrar };
}
