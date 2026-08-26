import type { PorDia } from "./api";
import {
  CABECERA_SEMANA,
  clave,
  lunesDeLaSemana,
  mismoDia,
  rejilla,
} from "./fecha";

interface Props {
  anio: number;
  mes: number;
  hoy: Date;
  porDia: PorDia;
  /** Hacer clic en un día de un mes vecino navega a ese mes. */
  onNavegar: (anio: number, mes: number) => void;
}

export function VistaMes({ anio, mes, hoy, porDia, onNavegar }: Props) {
  const dias = rejilla(anio, mes);
  const lunesActual = clave(lunesDeLaSemana(hoy));

  return (
    <div className="calendario">
      <div className="cabecera-semana">
        {CABECERA_SEMANA.map((dia) => (
          <span key={dia}>{dia}</span>
        ))}
      </div>

      <div className="rejilla">
        {dias.map((fecha) => {
          const esDeEsteMes = fecha.getMonth() === mes - 1;
          const esHoy = mismoDia(fecha, hoy);
          const esSemanaActual = clave(lunesDeLaSemana(fecha)) === lunesActual;
          const eventos = porDia[clave(fecha)] ?? [];

          const clases = ["celda"];
          if (!esDeEsteMes) clases.push("fuera");
          if (esSemanaActual) clases.push("semana");
          if (esHoy) clases.push("hoy");

          return (
            <div
              key={clave(fecha)}
              className={clases.join(" ")}
              onClick={
                esDeEsteMes
                  ? undefined
                  : () => onNavegar(fecha.getFullYear(), fecha.getMonth() + 1)
              }
            >
              <span className="numero">{fecha.getDate()}</span>

              {/* Provisional: la disposición real de la celda es la etapa 7.
                  Acá los títulos van planos, solo para que la consulta de rango
                  se ejecute contra datos reales antes de que alguien la dibuje. */}
              {eventos.map((instancia) => (
                <div
                  key={`${instancia.evento_id}-${instancia.ocurrencia}`}
                  className="evento-plano"
                >
                  {instancia.titulo}
                  {instancia.de > 1 ? ` ${instancia.dia}/${instancia.de}` : ""}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
