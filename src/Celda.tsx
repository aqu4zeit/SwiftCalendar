import { useEffect, useRef, useState } from "react";

import type { Instancia } from "./api";
import { horaDe, type FormatoHora } from "./fecha";
import { useListaConSalida } from "./presencia";

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
}: Props) {
  const lista = useRef<HTMLDivElement>(null);
  const [desborda, setDesborda] = useState(false);

  // Los que se borran o que un filtro esconde se quedan hasta terminar de irse.
  const dibujados = useListaConSalida(
    eventos,
    (i) => `${i.evento_id}-${i.ocurrencia}`,
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
      onClick={
        esDeEsteMes
          ? () => onAbrirDia(fecha)
          : () => onNavegar(fecha.getFullYear(), fecha.getMonth() + 1)
      }
    >
      <span className="numero">{fecha.getDate()}</span>

      <div className="eventos" ref={lista}>
        {dibujados.length === 1 ? (
          <EventoSolo
            instancia={dibujados[0].item}
            saliendo={dibujados[0].saliendo}
            formato={formatoHora}
            onAbrir={onAbrir}
          />
        ) : (
          dibujados.map(({ item, saliendo }) => (
            <EventoCompacto
              key={`${item.evento_id}-${item.ocurrencia}`}
              instancia={item}
              saliendo={saliendo}
              formato={formatoHora}
              onAbrir={onAbrir}
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
  onAbrir: (instancia: Instancia) => void;
}

/** Un día con un solo evento tiene sitio para contar algo más. */
function EventoSolo({ instancia, saliendo, formato, onAbrir }: FilaProps) {
  const clases = [instancia.descripcion ? "ev-solo" : "ev-solo centrado"];
  if (saliendo) clases.push("saliendo");

  return (
    <div
      className={clases.join(" ")}
      onClick={(e) => {
/** El clic en el evento no debe llegar a la celda, que abre el día. */
        e.stopPropagation();
        onAbrir(instancia);
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
    </div>
  );
}

/** Desde dos eventos, cada uno es una fila de una línea. */
function EventoCompacto({ instancia, saliendo, formato, onAbrir }: FilaProps) {
  return (
    <div
      className={saliendo ? "ev saliendo" : "ev"}
      onClick={(e) => {
        e.stopPropagation();
        onAbrir(instancia);
      }}
    >
      <Marca instancia={instancia} />
      <Hora instancia={instancia} formato={formato} />
      <span className="titulo-ev">{instancia.titulo}</span>
      <Continuidad instancia={instancia} />
    </div>
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
