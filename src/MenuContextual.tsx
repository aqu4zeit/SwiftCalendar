import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Una entrada del menú. */
export interface Entrada {
  id: string;
  texto: string;
  /** Un signo al otro extremo de la fila, en el hueco que deja el texto. */
  signo?: string;
  /** Las que no se pueden deshacer se dibujan aparte. */
  malo?: boolean;
}

interface Props {
  entradas: Entrada[];
  /** Dónde se hizo clic, en coordenadas de la ventana. */
  x: number;
  y: number;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  onElegir: (id: string) => void;
  onCerrar: () => void;
}

/** El aire mínimo hasta el borde de la ventana. */
const AIRE = 6;

/**
 * El menú del clic derecho.
 *
 * Recibe sus entradas ya armadas, igual que la paleta recibe sus comandos: esta
 * pantalla sabe dibujar y colocar, no qué se puede hacer con un evento. Así el
 * mismo menú sirve para el evento y para la celda vacía sin saber de ninguno.
 *
 * A diferencia del menú de la bandeja, este vive dentro de nuestra ventana, así
 * que se dibuja con CSS como cualquier otra cosa.
 */
export function MenuContextual({
  entradas,
  x,
  y,
  saliendo,
  onElegir,
  onCerrar,
}: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const [sitio, setSitio] = useState<{ left: number; top: number } | null>(null);

  /*
   * Se coloca después de medirlo, no antes.
   *
   * Cuántas entradas tiene lo decide quien lo abre, así que su tamaño no se
   * conoce hasta que existe. Con `useLayoutEffect` el navegador no llega a
   * pintar la posición provisional.
   */
  useLayoutEffect(() => {
    const nodo = caja.current;
    if (!nodo) return;

    const { width, height } = nodo.getBoundingClientRect();

    // Cabe hacia abajo y a la derecha salvo que no quepa: entonces crece hacia
    // el otro lado desde el mismo punto, como cualquier menú del sistema.
    setSitio({
      left:
        x + width + AIRE <= window.innerWidth ? x : Math.max(AIRE, x - width),
      top:
        y + height + AIRE <= window.innerHeight
          ? y
          : Math.max(AIRE, y - height),
    });
  }, [x, y, entradas.length]);

  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      // Es lo más interno que puede haber abierto: se queda con la tecla.
      evento.stopPropagation();
      onCerrar();
    }

    document.addEventListener("keydown", tecla, true);
    window.addEventListener("resize", onCerrar);

    return () => {
      document.removeEventListener("keydown", tecla, true);
      window.removeEventListener("resize", onCerrar);
    };
  }, [onCerrar]);

  return (
    <>
      {/*
       * Cerrar y apretar lo de abajo son dos cosas distintas.
       *
       * Escuchando el clic en el documento el menú se cerraba, pero el clic
       * seguía su camino y abría además la celda de abajo. Una tapa de verdad
       * se lo queda: es a ella a quien se apretó. Es lo mismo que hace el velo
       * de las ventanas, sin oscurecer nada.
       *
       * También se lleva la rueda: la posición está calculada contra un punto
       * que al desplazarse deja de valer.
       */}
      <div
        className={saliendo ? "tapa-menu saliendo" : "tapa-menu"}
        onMouseDown={onCerrar}
        onWheel={onCerrar}
        onContextMenu={(e) => {
          e.preventDefault();
          onCerrar();
        }}
      />
      <div
        ref={caja}
        className={saliendo ? "menu-contextual saliendo" : "menu-contextual"}
        // Mientras no se ha medido se dibuja fuera de la vista: ponerlo en el
        // cursor y moverlo después se ve como un salto.
        style={sitio ?? { left: 0, top: 0, visibility: "hidden" as const }}
      >
        {entradas.map((entrada) => (
          <button
            key={entrada.id}
            type="button"
            className={entrada.malo ? "opcion-menu mala" : "opcion-menu"}
            onClick={() => onElegir(entrada.id)}
          >
            {entrada.texto}
            {entrada.signo && <span>{entrada.signo}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
