import { useState } from "react";

import { CABECERA_SEMANA, clave, mesYAnio, rejilla } from "./fecha";

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

  function mover(meses: number) {
    const destino = new Date(anio, mes - 1 + meses, 1);
    setAnio(destino.getFullYear());
    setMes(destino.getMonth() + 1);
  }

  const hoy = clave(new Date());

  return (
    <div className="mini-cal">
      <div className="mini-cab">
        <button type="button" className="mini-paso" onClick={() => mover(-1)}>
          ‹
        </button>
        <span>{mesYAnio(anio, mes)}</span>
        <button type="button" className="mini-paso" onClick={() => mover(1)}>
          ›
        </button>
      </div>

      <div className="mini-dow">
        {CABECERA_SEMANA.map((dia) => (
          <span key={dia}>{dia.charAt(0)}</span>
        ))}
      </div>

      <div className="mini-rejilla">
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
