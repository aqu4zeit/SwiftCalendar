import { useEffect, useRef, useState } from "react";

/**
 * Lo que tarda una ventana en irse.
 *
 * Este número y el de `estilos.css` describen la misma animación: si uno cambia,
 * el otro también. Más corto que la entrada a propósito — cuando cierras algo ya
 * decidiste, y esperar molesta.
 */
export const MS_SALIDA = 120;

/**
 * Mantiene un valor vivo mientras su ventana se va.
 *
 * React desmonta en cuanto el estado se vacía, así que sin esto una ventana no
 * alcanza a animar su salida: desaparece de golpe. Acá el valor se conserva
 * hasta que la animación termina, y `saliendo` dice cuándo dibujarla yéndose.
 */
export function usePresencia<T>(valor: T | null): {
  valor: T | null;
  saliendo: boolean;
} {
  const [dibujado, setDibujado] = useState<T | null>(valor);
  const [saliendo, setSaliendo] = useState(false);
  const habia = useRef(valor !== null);

  useEffect(() => {
    if (valor !== null) {
      habia.current = true;
      setDibujado(valor);
      setSaliendo(false);
      return;
    }

    if (!habia.current) return;
    setSaliendo(true);

    const temporizador = setTimeout(() => {
      habia.current = false;
      setDibujado(null);
      setSaliendo(false);
    }, MS_SALIDA);

    return () => clearTimeout(temporizador);
  }, [valor]);

  return { valor: dibujado, saliendo };
}

/** Un elemento de la lista, sabiendo si está entrando o yéndose. */
export interface EnLista<T> {
  item: T;
  saliendo: boolean;
}

/**
 * Lo mismo que `usePresencia`, para una lista.
 *
 * Un evento que se borra o que un filtro esconde desaparece de la lista, y React
 * lo desmonta en el mismo cuadro. Acá se queda en el sitio que tenía, marcado
 * como saliendo, hasta que termina su animación.
 */
export function useListaConSalida<T>(
  items: T[],
  clave: (item: T) => string,
): EnLista<T>[] {
  const [lista, setLista] = useState<EnLista<T>[]>(() =>
    items.map((item) => ({ item, saliendo: false })),
  );

  useEffect(() => {
    setLista((previas) => {
      // Sin esta salida, cada render traería una lista nueva y el estado se
      // volvería a escribir para siempre.
      const igual =
        previas.length === items.length &&
        previas.every((e, i) => !e.saliendo && e.item === items[i]);
      if (igual) return previas;

      const claves = new Set(items.map(clave));
      const resultado: EnLista<T>[] = items.map((item) => ({
        item,
        saliendo: false,
      }));

      // Los que ya no están vuelven a su posición anterior, marcados.
      previas.forEach((anterior, indice) => {
        if (claves.has(clave(anterior.item))) return;
        resultado.splice(Math.min(indice, resultado.length), 0, {
          item: anterior.item,
          saliendo: true,
        });
      });

      return resultado;
    });
    // `clave` se recrea en cada render; lo que manda es la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    if (!lista.some((e) => e.saliendo)) return;

    const temporizador = setTimeout(
      () => setLista((actual) => actual.filter((e) => !e.saliendo)),
      MS_SALIDA,
    );

    return () => clearTimeout(temporizador);
  }, [lista]);

  return lista;
}
