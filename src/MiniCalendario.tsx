import { useState } from "react";

import { CABECERA_SEMANA, clave, fechaLarga, mesYAnio, rejilla } from "./fecha";
import type { Sentido } from "./VistaMes";

interface Props {
  /** La fecha elegida, en `AAAA-MM-DD`, o vacío si no hay ninguna. */
  valor: string;
  onElegir: (iso: string) => void;
}

/** Calendario de un mes para elegir una fecha con el mouse. */
export function MiniCalendario({ valor, onElegir }: Props) {
  const inicial = valor ? new Date(`${valor}T00:00:00`) : new Date();
  const [anio, setAnio] = useState(inicial.getFullYear());
  const [mes, setMes] = useState(inicial.getMonth() + 1);
  // Al abrir no hay: el mes aparece con el panel, no llega desde un costado.
  const [sentido, setSentido] = useState<Sentido>();

  function mover(meses: number) {
    setSentido(meses > 0 ? "adelante" : "atras");
    const destino = new Date(anio, mes - 1 + meses, 1);
    setAnio(destino.getFullYear());
    setMes(destino.getMonth() + 1);
  }

  const hoy = clave(new Date());

  return (
    <div className="mini-cal">
      <div className="mini-cab">
        <button type="button" className="mini-paso"
          aria-label="Mes anterior"
          onClick={() => mover(-1)}
        >
          <span className="gesto gesto-izquierda" aria-hidden="true">‹</span>
        </button>
        <span>{mesYAnio(anio, mes)}</span>
        <button type="button" className="mini-paso"
          aria-label="Mes siguiente"
          onClick={() => mover(1)}
        >
          <span className="gesto gesto-derecha" aria-hidden="true">›</span>
        </button>
      </div>

      <div className="mini-dow">
        {CABECERA_SEMANA.map((dia) => (
          <span key={dia}>{dia.charAt(0)}</span>
        ))}
      </div>

      <div
        className="mini-rejilla"
        key={`${anio}-${mes}`}
        data-sentido={sentido}
      >
        {rejilla(anio, mes).map((fecha) => {
          const iso = clave(fecha);
          const clases = ["mini-dia"];
          if (fecha.getMonth() !== mes - 1) clases.push("fuera");
          if (iso === hoy) clases.push("es-hoy");
          if (iso === valor) clases.push("elegido");

          return (
            <button
              key={iso}
              type="button"
              className={clases.join(" ")}
              // El número solo no dice de qué mes es; el nombre completo sí.
              aria-label={`${fechaLarga(fecha)} de ${fecha.getFullYear()}`}
              aria-pressed={iso === valor}
              aria-current={iso === hoy ? "date" : undefined}
              onClick={() => onElegir(iso)}
            >
              {fecha.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
