import { useEffect, useRef, useState } from "react";

import type { Instancia } from "./api";
import { clave, fechaLarga, horaDe, type FormatoHora } from "./fecha";
import { useListaConSalida } from "./presencia";
import { nombreDeInstancia } from "./texto";

interface Props {
  fecha: Date;
  esDeEsteMes: boolean;
  esHoy: boolean;
  esSemanaActual: boolean;
  eventos: Instancia[];
  formatoHora: FormatoHora;
  onNavegar: (anio: number, mes: number) => void;
  onAbrir: (instancia: Instancia) => void;
  onAbrirDia: (fecha: Date) => void;
  /** Clic derecho sobre un evento, o sobre el hueco de la celda. */
  onMenu: (
    x: number,
    y: number,
    sobre: { instancia: Instancia } | { fecha: Date },
  ) => void;
  /**
   * Si es el día por el que entra el tabulador. La cuadrícula es una sola
   * parada: el resto de los días y sus eventos se alcanzan con las flechas.
   */
  activo: boolean;
  /** El foco llegó a este día: pasa a ser el de entrada. */
  onElegir: () => void;
}

export function Celda({
  fecha,
  esDeEsteMes,
  esHoy,
  esSemanaActual,
  eventos,
  formatoHora,
  onNavegar,
  onAbrir,
  onAbrirDia,
  onMenu,
  activo,
  onElegir,
}: Props) {
  const lista = useRef<HTMLDivElement>(null);
  const [desborda, setDesborda] = useState(false);

  // Los que se borran o que un filtro esconde se quedan hasta terminar de irse.
  const dibujados = useListaConSalida(
    eventos,
    (i) => `${i.evento_id}-${i.ocurrencia}`,
    (i) => String(i.evento_id),
  );

  useEffect(() => {
    const nodo = lista.current;
    if (!nodo) return;

    // El indicador aparece cuando el contenido no cabe, no por cantidad.
    const revisar = () =>
      setDesborda(nodo.scrollHeight > nodo.clientHeight + 1);

    revisar();
    const observador = new ResizeObserver(revisar);
    observador.observe(nodo);
    return () => observador.disconnect();
  }, [dibujados]);

  const clases = ["celda"];
  if (!esDeEsteMes) clases.push("fuera");
  if (esSemanaActual) clases.push("semana");
  if (esHoy) clases.push("hoy");

  return (
    <div
      className={clases.join(" ")}
      // El día es el lugar al que vuelve el teclado cuando lo que se abrió
      // desde acá ya no está: el hueco de la celda, un evento borrado.
      data-foco-zona
      data-dia={clave(fecha)}
      // Enfocar el día o uno de sus eventos, con el ratón o el teclado, lo
      // vuelve el día por el que entra el tabulador.
      onFocus={esDeEsteMes ? onElegir : undefined}
      onClick={
        esDeEsteMes
          ? () => onAbrirDia(fecha)
          : () => onNavegar(fecha.getFullYear(), fecha.getMonth() + 1)
      }
      // El hueco de la celda ofrece crear un evento ese día. En los días de otro
      // mes no: esa celda es un atajo para navegar, no un día de este mes.
      onContextMenu={(e) => {
        if (!esDeEsteMes) return;
        e.preventDefault();
        onMenu(e.clientX, e.clientY, { fecha });
      }}
    >
      {/* Un botón para que el teclado llegue al día. El clic sube hasta la
          celda, que es la que sabe qué hacer con él. Solo el día activo está
          en el recorrido del tabulador; a los demás se llega con las flechas,
          y los de otro mes solo sirven de atajo al mes vecino. */}
      <button
        type="button"
        className="numero"
        data-foco-ancla
        aria-label={fechaLarga(fecha)}
        aria-current={esHoy ? "date" : undefined}
        tabIndex={esDeEsteMes && activo ? 0 : -1}
      >
        {fecha.getDate()}
      </button>

      <div className="eventos" ref={lista}>
        {dibujados.length === 1 ? (
          <EventoSolo
            instancia={dibujados[0].item}
            saliendo={dibujados[0].saliendo}
            formato={formatoHora}
            onAbrir={onAbrir}
            onMenu={onMenu}
            enRecorrido={activo}
          />
        ) : (
          dibujados.map(({ item, saliendo }) => (
            <EventoCompacto
              key={`${item.evento_id}-${item.ocurrencia}`}
              instancia={item}
              saliendo={saliendo}
              formato={formatoHora}
              onAbrir={onAbrir}
              onMenu={onMenu}
              enRecorrido={activo}
            />
          ))
        )}
      </div>

      {desborda && (
        <div className="hay-mas">
          <i />
        </div>
      )}
    </div>
  );
}

interface FilaProps {
  instancia: Instancia;
  saliendo: boolean;
  formato: FormatoHora;
  /** Si el tabulador pasa por este evento: solo los del día activo. */
  enRecorrido: boolean;
  onAbrir: (instancia: Instancia) => void;
  onMenu: (
    x: number,
    y: number,
    sobre: { instancia: Instancia } | { fecha: Date },
  ) => void;
}

/** Un día con un solo evento tiene sitio para contar algo más. */
function EventoSolo({
  instancia,
  saliendo,
  formato,
  enRecorrido,
  onAbrir,
  onMenu,
}: FilaProps) {
  const clases = [instancia.descripcion ? "ev-solo" : "ev-solo centrado"];
  if (saliendo) clases.push("saliendo");

  return (
    <button
      type="button"
      className={clases.join(" ")}
      // El globo muestra el nombre entero solo cuando el título no entra.
      data-globo="cortado"
      tabIndex={enRecorrido ? 0 : -1}
      aria-label={nombreDeInstancia(instancia, formato)}
      // El clic en el evento no debe llegar a la celda, que abre el día.
      onClick={(e) => {
        e.stopPropagation();
        onAbrir(instancia);
      }}
      onContextMenu={(e) => {
        // Igual que el clic izquierdo: no llega a la celda, que ofrece crear.
        e.preventDefault();
        e.stopPropagation();
        onMenu(e.clientX, e.clientY, { instancia });
      }}
    >
      <Marca instancia={instancia} />
      <span className="texto">
        <span className="linea-titulo">
          <span className="titulo-ev">{instancia.titulo}</span>
          <Continuidad instancia={instancia} />
        </span>
        <Hora instancia={instancia} formato={formato} />
        {instancia.descripcion && (
          <span className="descripcion">{instancia.descripcion}</span>
        )}
      </span>
    </button>
  );
}

/** Desde dos eventos, cada uno es una fila de una línea. */
function EventoCompacto({
  instancia,
  saliendo,
  formato,
  enRecorrido,
  onAbrir,
  onMenu,
}: FilaProps) {
  return (
    <button
      type="button"
      className={saliendo ? "ev saliendo" : "ev"}
      data-globo="cortado"
      tabIndex={enRecorrido ? 0 : -1}
      aria-label={nombreDeInstancia(instancia, formato)}
      onClick={(e) => {
        e.stopPropagation();
        onAbrir(instancia);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(e.clientX, e.clientY, { instancia });
      }}
    >
      <Marca instancia={instancia} />
      <Hora instancia={instancia} formato={formato} />
      <span className="titulo-ev">{instancia.titulo}</span>
      <Continuidad instancia={instancia} />
    </button>
  );
}

/** La barra izquierda: la forma dice la importancia, el color dice el grupo. */
function Marca({ instancia }: { instancia: Instancia }) {
  const estilo =
    instancia.importancia === "urgente"
      ? { background: instancia.color }
      : instancia.importancia === "importante"
        ? { borderColor: instancia.color }
        : undefined;

  return <span className="marca" style={estilo} />;
}

/** La hora del evento. */
function Hora({
  instancia,
  formato,
}: {
  instancia: Instancia;
  formato: FormatoHora;
}) {
  if (instancia.todo_el_dia) return null;

  return (
    <span className="hora">
      {horaDe(instancia.inicio, formato)}
      {instancia.fin && (
        <span className="hora-fin">–{horaDe(instancia.fin, formato)}</span>
      )}
    </span>
  );
}

/** Dónde va este día dentro de un evento que abarca varios. */
function Continuidad({ instancia }: { instancia: Instancia }) {
  if (instancia.de === 1) return null;

  return (
    <span className="continuidad">
      {instancia.dia}/{instancia.de}
    </span>
  );
}
