import { useEffect, useRef, useState } from "react";

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

/** El lado desde el que entra un mes nuevo. */
export type Sentido = "adelante" | "atras";

/** Cuántas casillas mueve cada flecha en una rejilla de siete columnas. */
const SALTOS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/** El primer día del mes en la rejilla. Toda rejilla tiene alguno. */
function primeroDelMes(dias: Date[], delMes: (fecha: Date) => boolean): Date {
  const primero = dias.find(delMes);
  if (!primero) throw new Error("la rejilla no tiene ningún día del mes");
  return primero;
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
  const delMes = (fecha: Date) => fecha.getMonth() === mes - 1;

  /*
   * El día por el que el tabulador entra a la cuadrícula.
   *
   * La cuadrícula es una sola parada de Tab y las flechas se mueven entre
   * días: antes eran una parada por día y por evento —33 en un mes con pocos
   * eventos— y ↑ ↓ no hacían nada. Es el último día enfocado si sigue en este
   * mes; si no, hoy si se ve, y si no el primero del mes.
   */
  const [elegido, setElegido] = useState<string | null>(null);
  const activo =
    elegido !== null && dias.some((f) => delMes(f) && clave(f) === elegido)
      ? elegido
      : clave(dias.find((f) => delMes(f) && mismoDia(f, hoy)) ?? primeroDelMes(dias, delMes));

  // El día al que hay que llevar el foco cuando la flecha cambió de mes: la
  // cuadrícula nueva recién existe después de dibujarla.
  const rejillaRef = useRef<HTMLDivElement>(null);
  const aEnfocar = useRef<string | null>(null);

  function enfocarDia(dia: string) {
    rejillaRef.current
      ?.querySelector<HTMLElement>(`[data-dia="${dia}"] [data-foco-ancla]`)
      ?.focus();
  }

  useEffect(() => {
    if (aEnfocar.current === null) return;
    enfocarDia(aEnfocar.current);
    aEnfocar.current = null;
  }, [anio, mes]);

  /*
   * ← → un día, ↑ ↓ una semana, con el foco en un día o en uno de sus eventos.
   * El paso es de casilla en la rejilla, no una cuenta de fechas. Si se sale
   * del mes se cambia de mes, y si se sale de la cuadrícula el destino se busca
   * en la del mes vecino, que también contiene el día de partida.
   */
  function tecla(evento: React.KeyboardEvent) {
    const salto = SALTOS[evento.key];
    const celda = (evento.target as HTMLElement).closest<HTMLElement>("[data-dia]");
    if (salto === undefined || celda === null) return;
    if (evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;
    evento.preventDefault();
    // Si sube, App lo toma como cambiar de mes.
    evento.stopPropagation();

    const desde = celda.dataset.dia;
    let lista = dias;
    let casilla = lista.findIndex((f) => clave(f) === desde) + salto;
    if (casilla < 0 || casilla >= lista.length) {
      const hacia = casilla < 0 ? -1 : 1;
      const anioVecino = mes + hacia === 0 ? anio - 1 : mes + hacia === 13 ? anio + 1 : anio;
      const mesVecino = mes + hacia === 0 ? 12 : mes + hacia === 13 ? 1 : mes + hacia;
      lista = rejilla(anioVecino, mesVecino);
      casilla = lista.findIndex((f) => clave(f) === desde) + salto;
    }

    const destino = lista[casilla];
    const claveDestino = clave(destino);
    setElegido(claveDestino);
    if (delMes(destino)) {
      enfocarDia(claveDestino);
      return;
    }
    aEnfocar.current = claveDestino;
    onNavegar(destino.getFullYear(), destino.getMonth() + 1);
  }

  // Hacia dónde se movió el calendario, para que el mes nuevo entre desde ese
  // lado. Se compara al dibujar, antes de montar la cuadrícula nueva: si se
  // guardara después, la primera vez que se ve ya habría entrado sin sentido.
  const indice = anio * 12 + mes;
  const [paso, setPaso] = useState<{ indice: number; sentido?: Sentido }>({
    indice,
  });
  if (paso.indice !== indice) {
    setPaso({ indice, sentido: indice > paso.indice ? "adelante" : "atras" });
  }
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
      <div
        className="rejilla"
        key={`${anio}-${mes}`}
        ref={rejillaRef}
        onKeyDown={tecla}
        data-sentido={paso.sentido}
        // El sentido vale mientras el mes entra. Después se quita, para que
        // un evento creado más tarde tenga su propia entrada; los de las
        // celdas también terminan animaciones, y esas no cuentan.
        onAnimationEnd={(e) => {
          if (e.target === e.currentTarget) setPaso({ indice });
        }}
      >
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
            activo={clave(fecha) === activo}
            onElegir={() => setElegido(clave(fecha))}
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
