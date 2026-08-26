import { useRef, useState, type PointerEvent as EventoPuntero } from "react";

import { useFlotante } from "./flotante";

/** Alto del panel, para saber si cabe debajo del botón. */
const ALTO_PANEL = 236;

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function entre0y1(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function aHex({ h, s, v }: Hsv): string {
  const canal = (n: number) => {
    const k = (n + h / 60) % 6;
    const valor = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    return Math.round(valor * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${canal(5)}${canal(3)}${canal(1)}`;
}

function desdeHex(hex: string): Hsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const alto = Math.max(r, g, b);
  const bajo = Math.min(r, g, b);
  const rango = alto - bajo;

  let h = 0;
  if (rango !== 0) {
    if (alto === r) h = 60 * (((g - b) / rango) % 6);
    else if (alto === g) h = 60 * ((b - r) / rango + 2);
    else h = 60 * ((r - g) / rango + 4);
  }

  return { h: h < 0 ? h + 360 : h, s: alto === 0 ? 0 : rango / alto, v: alto };
}

/** `#rrggbb`, o `null` si no lo es. */
function hexValido(texto: string): string | null {
  const limpio = texto.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(limpio) ? limpio : null;
}

interface Props {
  color: string;
  onCambiar: (hex: string) => void;
}

/**
 * El selector de color de la aplicación.
 *
 * No usa `input type="color"` por la misma razón que no se usa `select`: su
 * ventana la dibuja Windows, siempre en claro, y no acepta el tema.
 */
export function SelectorColor({ color, onCambiar }: Props) {
  const { ancla, panel, posicion, abierto, saliendo, abrir, cerrar } =
    useFlotante(ALTO_PANEL);

  const [hsv, setHsv] = useState<Hsv>(() => desdeHex(color));
  const [texto, setTexto] = useState(color);
  const cuadro = useRef<HTMLDivElement>(null);
  const barra = useRef<HTMLDivElement>(null);

  function aplicar(nuevo: Hsv) {
    setHsv(nuevo);
    const hex = aHex(nuevo);
    setTexto(hex);
    onCambiar(hex);
  }

  function abrirDesde() {
    // El color pudo cambiar desde la paleta mientras el panel estaba cerrado.
    setHsv(desdeHex(color));
    setTexto(color);
    abrir();
  }

  function moverEnCuadro(evento: EventoPuntero<HTMLDivElement>) {
    const caja = cuadro.current?.getBoundingClientRect();
    if (!caja) return;

    aplicar({
      ...hsv,
      s: entre0y1((evento.clientX - caja.left) / caja.width),
      v: 1 - entre0y1((evento.clientY - caja.top) / caja.height),
    });
  }

  function moverEnBarra(evento: EventoPuntero<HTMLDivElement>) {
    const caja = barra.current?.getBoundingClientRect();
    if (!caja) return;

    aplicar({
      ...hsv,
      h: entre0y1((evento.clientX - caja.left) / caja.width) * 360,
    });
  }

  return (
    <div className="selector-color" ref={ancla}>
      <button
        type="button"
        className="color-libre"
        onClick={() => (abierto ? cerrar() : abrirDesde())}
        title="Elegir otro color"
      >
        +
      </button>

      {posicion && (
        <div
          className={
            saliendo ? "flotante panel-color saliendo" : "flotante panel-color"
          }
          ref={panel}
          style={{ top: posicion.top, left: posicion.left }}
        >
          <div
            className="cuadro-color"
            ref={cuadro}
            style={{ background: `hsl(${hsv.h} 100% 50%)` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              moverEnCuadro(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) moverEnCuadro(e);
            }}
          >
            <span
              className="tirador"
              style={{
                left: `${hsv.s * 100}%`,
                top: `${(1 - hsv.v) * 100}%`,
                background: aHex(hsv),
              }}
            />
          </div>

          <div
            className="barra-tono"
            ref={barra}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              moverEnBarra(e);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 1) moverEnBarra(e);
            }}
          >
            <span
              className="tirador"
              style={{
                left: `${(hsv.h / 360) * 100}%`,
                top: "50%",
                background: `hsl(${hsv.h} 100% 50%)`,
              }}
            />
          </div>

          <div className="fila-hex">
            <span className="previa-hex" style={{ background: color }} />
            <div className="campo">
              <input
                type="text"
                value={texto}
                spellCheck={false}
                onChange={(e) => {
                  setTexto(e.target.value);
                  const hex = hexValido(e.target.value);
                  if (hex) {
                    setHsv(desdeHex(hex));
                    onCambiar(hex);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
