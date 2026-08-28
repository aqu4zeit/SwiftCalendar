import type { Instancia, PorDia } from "./api";
import { Celda } from "./Celda";
import {
  CABECERA_SEMANA,
  clave,
  lunesDeLaSemana,
  mismoDia,
  rejilla,
  type FormatoHora,
} from "./fecha";

interface Props {
  anio: number;
  mes: number;
  hoy: Date;
  porDia: PorDia;
  formatoHora: FormatoHora;
  /** Hacer clic en un día de un mes vecino navega a ese mes. */
  onNavegar: (anio: number, mes: number) => void;
  /** Hacer clic en un evento abre su ficha. */
  onAbrir: (instancia: Instancia) => void;
  /** Hacer clic en el resto de la celda abre la vista día. */
  onAbrirDia: (fecha: Date) => void;
  /** Clic derecho sobre un evento, o sobre el hueco de una celda. */
  onMenu: (
    x: number,
    y: number,
    sobre: { instancia: Instancia } | { fecha: Date },
  ) => void;
  /** Verdadero si el filtro está escondiendo algo. */
  filtrado: boolean;
  onMostrarTodos: () => void;
}

export function VistaMes({
  anio,
  mes,
  hoy,
  porDia,
  formatoHora,
  onNavegar,
  onAbrir,
  onAbrirDia,
  filtrado,
  onMostrarTodos,
  onMenu,
}: Props) {
  const dias = rejilla(anio, mes);
  const lunesActual = clave(lunesDeLaSemana(hoy));

  // Un calendario en blanco por culpa de un filtro se lee como pérdida de
  // datos. El aviso solo aparece cuando hay un filtro apagado: un mes que de
  // verdad no tiene nada se deja vacío y ya.
  const vacioPorFiltro = filtrado && Object.keys(porDia).length === 0;

  return (
    <div className="calendario">
      <div className="cabecera-semana">
        {CABECERA_SEMANA.map((dia) => (
          <span key={dia}>{dia}</span>
        ))}
      </div>

      {/* La clave cambia con el mes, así que la cuadrícula se rehace y su
          animación de entrada vuelve a correr. Sin eso, cambiar de mes
          reemplaza el contenido sin que nada indique que cambió. */}
      <div className="rejilla" key={`${anio}-${mes}`}>
        {dias.map((fecha) => (
          <Celda
            key={clave(fecha)}
            fecha={fecha}
            esDeEsteMes={fecha.getMonth() === mes - 1}
            esHoy={mismoDia(fecha, hoy)}
            esSemanaActual={clave(lunesDeLaSemana(fecha)) === lunesActual}
            eventos={porDia[clave(fecha)] ?? []}
            formatoHora={formatoHora}
            onNavegar={onNavegar}
            onAbrir={onAbrir}
            onAbrirDia={onAbrirDia}
            onMenu={onMenu}
          />
        ))}
      </div>

      {vacioPorFiltro && (
        <div className="oculto-por-filtro">
          <p className="vacio-t">Hay eventos ocultos</p>
          <p className="vacio-s">
            El panel de filtros está escondiendo todo lo de este mes.
          </p>
          <button type="button" className="btn" onClick={onMostrarTodos}>
            Mostrar todos
          </button>
        </div>
      )}
    </div>
  );
}
