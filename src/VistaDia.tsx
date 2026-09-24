import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { urlDeArchivo, type Instancia } from "./api";
import {
  duracion,
  fechaDe,
  fechaLarga,
  horaDe,
  nombreDia,
  type FormatoHora,
} from "./fecha";
import { Mas } from "./Mas";
import { useListaConSalida } from "./presencia";
import { useVelo } from "./flotante";
import { nombreDeInstancia } from "./texto";

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
  /** Clic derecho sobre un evento de la lista. */
  onMenu: (x: number, y: number, instancia: Instancia) => void;
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
  onMenu,
}: Props) {
  // Enlaza cada ventana con su título para que el lector de pantalla la anuncie.
  const id = useId();
  const velo = useVelo(onCerrar);

  const lista = useRef<HTMLDivElement>(null);
  const [tope, setTope] = useState<number | null>(null);

  const dibujados = useListaConSalida(
    eventos,
    (i) => `${i.evento_id}-${i.ocurrencia}`,
    (i) => String(i.evento_id),
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
      {...velo}
    >
      <div
        className="vista-dia"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
      >
        <div className="dia-cab">
          <h2 id={`${id}-titulo`}>{fechaLarga(fecha)}</h2>
          <div className="dia-acciones">
            <button
              type="button"
              className="icono-chico"
              onClick={onCrear}
              data-globo aria-label="Nuevo evento este día"
            >
              <Mas />
            </button>
            <button type="button" className="cerrar" aria-label="Cerrar" onClick={onCerrar}>
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>

        {dibujados.length === 0 ? (
          <div className="dia-vacio">
            {/* Sin segunda línea: repetía lo que ya dicen el botón y la cruz. */}
            <p className="vacio-t">Sin eventos este día</p>
            <button type="button" className="btn" onClick={onCrear}>
              Nuevo evento <Mas />
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
                  onMenu={onMenu}
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
  onMenu: (x: number, y: number, instancia: Instancia) => void;
}

function Fila({
  instancia,
  saliendo,
  formato,
  carpeta,
  onAbrir,
  onMenu,
}: FilaProps) {
  const estilo =
    instancia.importancia === "urgente"
      ? { background: instancia.color }
      : instancia.importancia === "importante"
        ? { borderColor: instancia.color }
        : undefined;

  return (
    <button
      type="button"
      className={saliendo ? "dia-ev saliendo" : "dia-ev"}
      data-globo="cortado"
      aria-label={nombreDeInstancia(instancia, formato)}
      onClick={() => onAbrir(instancia)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(e.clientX, e.clientY, instancia);
      }}
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
      <span className="dia-txt">
        <span className="dia-tit">{instancia.titulo}</span>
        <span className="dia-hr">
          <Horario instancia={instancia} formato={formato} />
        </span>
        {instancia.descripcion && (
          <span className="dia-ds">{instancia.descripcion}</span>
        )}
        {instancia.de > 1 && (
          <span className="chip">
            Día {instancia.dia} de {instancia.de}
          </span>
        )}
      </span>
    </button>
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
