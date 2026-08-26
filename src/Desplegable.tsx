import { useFlotante } from "./flotante";

const ALTO_FILA = 34;
const ALTO_MAXIMO = 260;

export interface Opcion {
  valor: string;
  texto: string;
  /** Si viene, se dibuja un cuadrito de ese color a la izquierda. */
  color?: string;
}

interface Props {
  opciones: Opcion[];
  valor: string;
  onElegir: (valor: string) => void;
  /**
   * Una fila al pie que hace algo en vez de elegir.
   *
   * Va como prop y no como una opción más porque no es un valor: meterla en la
   * lista obligaría a reservar un texto que nadie puede elegir de verdad.
   */
  accion?: { texto: string; onAccion: () => void };
}

/** El desplegable de toda la aplicación. No usa `select` porque su lista la dibuja el sistema operativo y no acepta el tema. */
export function Desplegable({ opciones, valor, onElegir, accion }: Props) {
  const filas = opciones.length + (accion ? 1 : 0);
  const alto = Math.min(filas * ALTO_FILA + 10, ALTO_MAXIMO);
  const { ancla, panel, posicion, abierto, saliendo, abrir, cerrar } =
    useFlotante(alto);

  const elegida = opciones.find((o) => o.valor === valor);

  return (
    <div className="desplegable" ref={ancla}>
      <button
        type="button"
        className="campo como-boton"
        onClick={() => (abierto ? cerrar() : abrir())}
      >
        {elegida?.color && (
          <span className="punto" style={{ background: elegida.color }} />
        )}
        <span className="nombre">{elegida?.texto}</span>
        <svg
          className={abierto ? "caret abierto" : "caret"}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {posicion && (
        <div
          className={
            saliendo ? "flotante lista-opciones saliendo" : "flotante lista-opciones"
          }
          ref={panel}
          style={{
            top: posicion.top,
            left: posicion.left,
            width: posicion.width,
            maxHeight: ALTO_MAXIMO,
          }}
        >
          {opciones.map((o) => (
            <button
              key={o.valor}
              type="button"
              className={o.valor === valor ? "fila-opcion on" : "fila-opcion"}
              onClick={() => {
                onElegir(o.valor);
                cerrar();
              }}
            >
              {o.color && (
                <span className="punto" style={{ background: o.color }} />
              )}
              {o.texto}
            </button>
          ))}

          {accion && (
            <button
              type="button"
              className="fila-opcion accion"
              onClick={() => {
                accion.onAccion();
                cerrar();
              }}
            >
              {accion.texto}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
