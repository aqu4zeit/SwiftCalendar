import { useEffect, useRef, useState } from "react";

import { vistaPreviaImagen, type Recorte } from "./api";

/** El marco entero: lo que sale si no se toca nada. */
const COMPLETA: Recorte = { x: 0, y: 0, ancho: 1, alto: 1 };

/** Qué se está arrastrando. Las esquinas mueven un vértice; el centro, todo. */
type Agarre = "centro" | "ne" | "no" | "se" | "so";

/** Lo mínimo que puede medir el marco, en fracción del lado. */
const MINIMO = 0.05;

interface Props {
  origen: string;
  onCerrar: () => void;
  onElegir: (recorte: Recorte | null) => void;
}

/**
 * Elegir qué parte de la imagen se guarda, viendo antes cómo va a quedar.
 *
 * El recorte se aplica al guardar y no se puede deshacer después: lo que entra a
 * la carpeta de datos ya viene encuadrado. Guardar el original y el rectángulo
 * por separado permitiría reencuadrar, pero pondría la misma regla de recorte en
 * las tres vistas y en la base.
 */
export function Encuadre({ origen, onCerrar, onElegir }: Props) {
  const [vista, setVista] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [marco, setMarco] = useState<Recorte>(COMPLETA);

  // La proporción del archivo. El marco está en fracciones, así que por sí solo
  // no dice si el recorte queda panorámico: uno completo mide 1 por 1 sea la
  // imagen un panorama o un retrato.
  const [proporcion, setProporcion] = useState(1);

  // El recorte ya dibujado. Se recalcula al soltar, no en cada movimiento: es
  // un lienzo por vista y moverlo es continuo.
  const [recortada, setRecortada] = useState<string | null>(null);

  const caja = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ agarre: Agarre; x: number; y: number; desde: Recorte } | null>(
    null,
  );

  useEffect(() => {
    let vigente = true;

    vistaPreviaImagen(origen)
      .then((texto) => vigente && setVista(texto))
      .catch((e: unknown) => vigente && setError(String(e)));

    return () => {
      vigente = false;
    };
  }, [origen]);

  useEffect(() => {
    if (!vista) return;
    let vigente = true;

    dibujarRecorte(vista, marco).then((url) => {
      if (vigente) setRecortada(url);
    });

    return () => {
      vigente = false;
    };
  }, [vista, marco]);

  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  function empezar(agarre: Agarre, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    arrastre.current = { agarre, x: e.clientX, y: e.clientY, desde: marco };
  }

  useEffect(() => {
    function mover(e: MouseEvent) {
      const activo = arrastre.current;
      const nodo = caja.current;
      if (!activo || !nodo) return;

      const medidas = nodo.getBoundingClientRect();
      const dx = (e.clientX - activo.x) / medidas.width;
      const dy = (e.clientY - activo.y) / medidas.height;

      setMarco(mover_marco(activo.desde, activo.agarre, dx, dy));
    }

    function soltar() {
      arrastre.current = null;
    }

    document.addEventListener("mousemove", mover);
    document.addEventListener("mouseup", soltar);
    return () => {
      document.removeEventListener("mousemove", mover);
      document.removeEventListener("mouseup", soltar);
    };
  }, []);

  const entera = marco.ancho === 1 && marco.alto === 1;

  return (
    <div className="velo interno" onClick={(e) => e.stopPropagation()}>
      <div className="modal ancho">
        <div className="modal-cab">
          <h2>Encuadrar la imagen</h2>
          <button type="button" className="cerrar" onClick={onCerrar}>
            ✕
          </button>
        </div>

        <div className="modal-cuerpo">
          {error && <div className="msg-error">{error}</div>}

          {!error && !vista && <p className="parrafo">Preparando la imagen…</p>}

          {vista && (
            <div className="encuadre">
              <div className="encuadre-lienzo" ref={caja}>
                <img
                  src={vista}
                  alt=""
                  draggable={false}
                  onLoad={(e) =>
                    setProporcion(
                      e.currentTarget.naturalWidth / e.currentTarget.naturalHeight,
                    )
                  }
                />

                {/* Lo de fuera del marco se apaga con cuatro bandas en vez de
                    una sombra: así el interior queda sin nada encima y se ve el
                    color real. */}
                <div className="sombra" style={{ inset: `0 0 ${(1 - marco.y) * 100}% 0` }} />
                <div
                  className="sombra"
                  style={{ inset: `${(marco.y + marco.alto) * 100}% 0 0 0` }}
                />
                <div
                  className="sombra"
                  style={{
                    inset: `${marco.y * 100}% ${(1 - marco.x) * 100}% ${(1 - marco.y - marco.alto) * 100}% 0`,
                  }}
                />
                <div
                  className="sombra"
                  style={{
                    inset: `${marco.y * 100}% 0 ${(1 - marco.y - marco.alto) * 100}% ${(marco.x + marco.ancho) * 100}%`,
                  }}
                />

                <div
                  className="marco"
                  style={{
                    left: `${marco.x * 100}%`,
                    top: `${marco.y * 100}%`,
                    width: `${marco.ancho * 100}%`,
                    height: `${marco.alto * 100}%`,
                  }}
                  onMouseDown={(e) => empezar("centro", e)}
                >
                  {(["no", "ne", "so", "se"] as const).map((esquina) => (
                    <span
                      key={esquina}
                      className={`tirador ${esquina}`}
                      onMouseDown={(e) => empezar(esquina, e)}
                    />
                  ))}
                </div>
              </div>

              <div className="encuadre-vistas">
                <p className="encuadre-nota">
                  Arrastra el marco o sus esquinas. Así se va a ver:
                </p>

                <Muestra
                  titulo="En la ficha"
                  recortada={recortada}
                  panoramica={esPanoramica(marco, proporcion)}
                />
                <Muestra titulo="En la vista día" recortada={recortada} chica />
              </div>
            </div>
          )}
        </div>

        <div className="modal-pie">
          <button
            type="button"
            className="btn"
            disabled={entera}
            onClick={() => setMarco(COMPLETA)}
          >
            Imagen completa
          </button>
          <button
            type="button"
            className="btn pri"
            disabled={!vista}
            onClick={() => onElegir(entera ? null : marco)}
          >
            Usar esta imagen
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Cómo queda en un sitio concreto.
 *
 * Dibuja el recorte de verdad y lo muestra con el mismo `object-fit` que usa la
 * vista real. Colocarlo con posiciones calculadas sería escribir la regla de
 * recorte por segunda vez, y dos copias de una regla se separan.
 */
function Muestra({
  titulo,
  recortada,
  panoramica,
  chica,
}: {
  titulo: string;
  recortada: string | null;
  /** La ficha pone arriba lo panorámico y al costado el resto. */
  panoramica?: boolean;
  chica?: boolean;
}) {
  const alCostado = panoramica === false;

  return (
    <div className="muestra-sitio">
      <span className="muestra-t">{titulo}</span>
      <div
        className={
          chica ? "muestra dia" : alCostado ? "muestra lado" : "muestra ancha"
        }
      >
        {recortada && <img src={recortada} alt="" />}
      </div>
    </div>
  );
}

/** El mismo umbral que usa la ficha para decidir dónde va la imagen. */
export const PANORAMICA = 1.6;

/**
 * Si el recorte queda panorámico, con las medidas reales.
 *
 * El marco va en fracciones del archivo, así que su forma en pantalla es la del
 * marco multiplicada por la de la imagen: media anchura de un panorama sigue
 * siendo más ancha que alta.
 */
function esPanoramica(marco: Recorte, proporcion: number): boolean {
  return (marco.ancho / marco.alto) * proporcion >= PANORAMICA;
}

/** Mueve o redimensiona el marco, sin dejar que se salga ni se invierta. */
function mover_marco(
  desde: Recorte,
  agarre: Agarre,
  dx: number,
  dy: number,
): Recorte {
  if (agarre === "centro") {
    return {
      ...desde,
      x: acotar(desde.x + dx, 0, 1 - desde.ancho),
      y: acotar(desde.y + dy, 0, 1 - desde.alto),
    };
  }

  const izquierda = agarre === "no" || agarre === "so";
  const arriba = agarre === "no" || agarre === "ne";

  const x1 = izquierda
    ? acotar(desde.x + dx, 0, desde.x + desde.ancho - MINIMO)
    : desde.x;
  const x2 = izquierda
    ? desde.x + desde.ancho
    : acotar(desde.x + desde.ancho + dx, desde.x + MINIMO, 1);

  const y1 = arriba ? acotar(desde.y + dy, 0, desde.y + desde.alto - MINIMO) : desde.y;
  const y2 = arriba
    ? desde.y + desde.alto
    : acotar(desde.y + desde.alto + dy, desde.y + MINIMO, 1);

  return { x: x1, y: y1, ancho: x2 - x1, alto: y2 - y1 };
}

function acotar(valor: number, minimo: number, maximo: number): number {
  return Math.min(Math.max(valor, minimo), maximo);
}

/** El recorte, dibujado de verdad, para poder mostrarlo como lo hará la app. */
function dibujarRecorte(fuente: string, marco: Recorte): Promise<string> {
  return new Promise((resolver) => {
    const img = new Image();

    img.onload = () => {
      const ancho = Math.max(1, Math.round(img.naturalWidth * marco.ancho));
      const alto = Math.max(1, Math.round(img.naturalHeight * marco.alto));

      const lienzo = document.createElement("canvas");
      lienzo.width = ancho;
      lienzo.height = alto;

      const pincel = lienzo.getContext("2d");
      if (!pincel) {
        resolver(fuente);
        return;
      }

      pincel.drawImage(
        img,
        Math.round(img.naturalWidth * marco.x),
        Math.round(img.naturalHeight * marco.y),
        ancho,
        alto,
        0,
        0,
        ancho,
        alto,
      );

      resolver(lienzo.toDataURL("image/jpeg", 0.85));
    };

    img.src = fuente;
  });
}
