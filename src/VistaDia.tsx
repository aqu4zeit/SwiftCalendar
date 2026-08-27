import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { urlDeArchivo, type Instancia } from "./api";
import {
  duracion,
  fechaDe,
  fechaLarga,
  horaDe,
  nombreDia,
  type FormatoHora,
} from "./fecha";
import { useListaConSalida } from "./presencia";

/** La ventana crece hasta acá y desde el siguiente hace scroll. */
const EVENTOS_VISIBLES = 5;

interface Props {
  fecha: Date;
  eventos: Instancia[];
  formatoHora: FormatoHora;
  /** La carpeta de datos: lo guardado es relativo a ella. */
  carpeta: string;
  /** Falso si hay otra ventana encima: el teclado lo cierra a él, no a este. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  onCerrar: () => void;
  onAbrir: (instancia: Instancia) => void;
  onCrear: () => void;
}

export function VistaDia({
  fecha,
  eventos,
  formatoHora,
  carpeta,
  activo,
  saliendo,
  onCerrar,
  onAbrir,
  onCrear,
}: Props) {
  const lista = useRef<HTMLDivElement>(null);
  const [tope, setTope] = useState<number | null>(null);

  const dibujados = useListaConSalida(
    eventos,
    (i) => `${i.evento_id}-${i.ocurrencia}`,
  );

  // El tope se mide sobre los cinco primeros, no se calcula con una altura
  // supuesta: una fila con descripción y otra sin ella no miden lo mismo.
  useLayoutEffect(() => {
    const nodo = lista.current;
    if (!nodo || dibujados.length <= EVENTOS_VISIBLES) {
      setTope(null);
      return;
    }

    const filas = Array.from(nodo.children) as HTMLElement[];
    const ultima = filas[EVENTOS_VISIBLES - 1];
    setTope(ultima.offsetTop + ultima.offsetHeight - filas[0].offsetTop);
  }, [dibujados]);

  useEffect(() => {
    if (!activo) return;

    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") onCerrar();
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [activo, onCerrar]);

  return (
    <div
      className={saliendo ? "velo saliendo" : "velo"}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="vista-dia">
        <div className="dia-cab">
          <h2>{fechaLarga(fecha)}</h2>
          <div className="dia-acciones">
            <button
              type="button"
              className="icono-chico"
              onClick={onCrear}
              data-texto="Nuevo evento este día"
            >
              +
            </button>
            <button type="button" className="cerrar" onClick={onCerrar}>
              ✕
            </button>
          </div>
        </div>

        {dibujados.length === 0 ? (
          <div className="dia-vacio">
            <p className="vacio-t">No hay nada este día</p>
            <p className="vacio-s">
              Puedes crear un evento desde acá o cerrar y volver al mes.
            </p>
            <button type="button" className="btn" onClick={onCrear}>
              Nuevo evento +
            </button>
          </div>
        ) : (
          <div className="dia-lista-caja">
            <div
              className="dia-lista"
              ref={lista}
              style={tope === null ? undefined : { maxHeight: tope }}
            >
              {dibujados.map(({ item, saliendo: yendose }) => (
                <Fila
                  key={`${item.evento_id}-${item.ocurrencia}`}
                  instancia={item}
                  saliendo={yendose}
                  formato={formatoHora}
                  carpeta={carpeta}
                  onAbrir={onAbrir}
                />
              ))}
            </div>
            {tope !== null && (
              <div className="hay-mas dia">
                <i />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface FilaProps {
  instancia: Instancia;
  saliendo: boolean;
  formato: FormatoHora;
  carpeta: string;
  onAbrir: (instancia: Instancia) => void;
}

function Fila({ instancia, saliendo, formato, carpeta, onAbrir }: FilaProps) {
  const estilo =
    instancia.importancia === "urgente"
      ? { background: instancia.color }
      : instancia.importancia === "importante"
        ? { borderColor: instancia.color }
        : undefined;

  return (
    <div
      className={saliendo ? "dia-ev saliendo" : "dia-ev"}
      onClick={() => onAbrir(instancia)}
    >
      <span className="marca" style={estilo} />
      {/* La celda del mes no la dibuja (decisión 63), pero la vista día sí:
          acá hay ancho y el evento se está mirando de cerca. Una ocurrencia
          separada de su serie comparte el archivo con la maestra. */}
      {instancia.miniatura && (
        <img
          className="dia-mini"
          src={urlDeArchivo(carpeta, instancia.miniatura)}
          alt=""
        />
      )}
      <div className="dia-txt">
        <div className="dia-tit">{instancia.titulo}</div>
        <div className="dia-hr">
          <Horario instancia={instancia} formato={formato} />
        </div>
        {instancia.descripcion && (
          <div className="dia-ds">{instancia.descripcion}</div>
        )}
        {instancia.de > 1 && (
          <span className="chip">
            Día {instancia.dia} de {instancia.de}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * La línea de horario de esta ocurrencia.
 *
 * Un evento que empezó ayer muestra la hora en que de verdad empezó, no un
 * 00:00 inventado: la marca de continuidad ya dice de qué día viene esa hora.
 */
function Horario({
  instancia,
  formato,
}: {
  instancia: Instancia;
  formato: FormatoHora;
}) {
  if (instancia.todo_el_dia) return <>Todo el día</>;

  const horas = instancia.fin
    ? `${horaDe(instancia.inicio, formato)} a ${horaDe(instancia.fin, formato)}`
    : horaDe(instancia.inicio, formato);

  const viene =
    instancia.dia > 1
      ? `viene del ${nombreDia(fechaDe(instancia.inicio))}`
      : null;

  const sigue =
    instancia.dia < instancia.de && instancia.fin
      ? `continúa el ${nombreDia(fechaDe(instancia.fin))}`
      : null;

  // Un evento de un solo día se mide; uno partido se ubica.
  const cola =
    viene ?? sigue ?? (instancia.fin ? duracion(instancia.inicio, instancia.fin) : null);

  return (
    <>
      {horas}
      {cola && <span className="sep">·</span>}
      {cola}
      {viene && sigue && (
        <>
          <span className="sep">·</span>
          {sigue}
        </>
      )}
    </>
  );
}
