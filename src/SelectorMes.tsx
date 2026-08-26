import { useEffect, useRef, useState } from "react";

import { MESES_DEL_ANIO, mesYAnio, nombreMes } from "./fecha";
import { usePresencia } from "./presencia";

/** Años visibles a cada lado del que se está mirando. */
const ANIOS_A_CADA_LADO = 2;

interface Props {
  anio: number;
  mes: number;
  onElegir: (anio: number, mes: number) => void;
}

export function SelectorMes({ anio, mes, onElegir }: Props) {
  const [abierto, setAbierto] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);

  // La lista sobrevive a su cierre lo que dura su animación.
  const visible = usePresencia(abierto ? true : null);
  const seleccionado = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!abierto) return;

    // Abrir en el mes que se está mirando.
    seleccionado.current?.scrollIntoView({ block: "center" });

    function fuera(evento: MouseEvent) {
      if (!contenedor.current?.contains(evento.target as Node)) {
        setAbierto(false);
      }
    }
    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") setAbierto(false);
    }

    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  const anios = Array.from(
    { length: ANIOS_A_CADA_LADO * 2 + 1 },
    (_, i) => anio - ANIOS_A_CADA_LADO + i,
  );

  return (
    <div className="selector" ref={contenedor}>
      <button className="selector-boton" onClick={() => setAbierto(!abierto)}>
        <h1>{mesYAnio(anio, mes)}</h1>
        {/* Chevron y no un cuadrado rotado: un cuadrado con dos bordes tiene su
            masa visual fuera del centro de su caja, así que centrarlo pide un
            desplazamiento a ojo, y otro distinto para el estado abierto. Este
            está centrado en su propio cuadro y girarlo no lo mueve. */}
        <svg
          className={abierto ? "caret abierto" : "caret"}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {visible.valor && (
        <div
          className={
            visible.saliendo ? "selector-panel saliendo" : "selector-panel"
          }
        >
          {anios.map((a) => (
            <div key={a}>
              <div className="selector-anio">{a}</div>
              {MESES_DEL_ANIO.map((m) => {
                const esActual = a === anio && m === mes;
                return (
                  <button
                    key={m}
                    ref={esActual ? seleccionado : undefined}
                    className={
                      esActual ? "selector-mes activo" : "selector-mes"
                    }
                    onClick={() => {
                      onElegir(a, m);
                      setAbierto(false);
                    }}
                  >
                    {nombreMes(m)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
