import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import {
  tamanoLegible,
  urlDeArchivo,
  type AdjuntoPedido,
  type ImagenPedida,
} from "./api";
import { Encuadre } from "./Encuadre";

/** Los formatos que sabe decodificar el lado nativo. */
const FORMATOS = ["png", "jpg", "jpeg", "gif", "bmp", "webp"];

interface Props {
  carpeta: string;
  imagen: ImagenPedida;
  onImagen: (imagen: ImagenPedida) => void;
  adjuntos: AdjuntoPedido[];
  onAdjuntos: (adjuntos: AdjuntoPedido[]) => void;
}

/**
 * La imagen y los archivos del evento, siempre visibles y en una línea cada uno.
 *
 * El boceto los pone dentro de "Más opciones" con una caja de arrastre alta. Acá
 * están afuera, porque esconder algo que se usa seguido cuesta un clic cada vez,
 * y a cambio ocupan lo mismo que ubicación o enlace mientras están vacíos.
 */
export function Archivos({
  carpeta,
  imagen,
  onImagen,
  adjuntos,
  onAdjuntos,
}: Props) {
  const zonaImagen = useRef<HTMLDivElement>(null);
  const zonaAdjuntos = useRef<HTMLDivElement>(null);
  const [encima, setEncima] = useState<"imagen" | "adjuntos" | null>(null);

  // La imagen elegida que todavía no se confirmó: primero se encuadra.
  const [encuadrando, setEncuadrando] = useState<string | null>(null);

  // Cómo quedó al encuadrarla. Una imagen recién elegida todavía no está en la
  // carpeta de datos, así que no hay archivo que pedir: esto es lo único que
  // permite verla antes de guardar el evento.
  const [muestra, setMuestra] = useState<string | null>(null);

  // Los valores vivos, para que el listener del arrastre no se vuelva a
  // suscribir en cada cambio ni lea una lista de hace dos renders.
  const estado = useRef({ imagen, adjuntos, onImagen, onAdjuntos });
  estado.current = { imagen, adjuntos, onImagen, onAdjuntos };

  /**
   * El arrastre no llega como evento del navegador.
   *
   * La webview entrega los archivos soltados por su propio canal, porque es el
   * único que trae la ruta en disco: un `File` del navegador no la tiene, y sin
   * ruta el lado nativo no puede copiar nada. A cambio el evento no dice sobre
   * qué elemento se soltó, así que hay que preguntarlo por la posición.
   */
  useEffect(() => {
    const quitar = getCurrentWebview().onDragDropEvent((evento) => {
      const carga = evento.payload;

      if (carga.type === "leave") {
        setEncima(null);
        return;
      }

      const punto = carga.position.toLogical(window.devicePixelRatio);
      const debajo = document.elementFromPoint(punto.x, punto.y);
      const destino = zonaImagen.current?.contains(debajo)
        ? "imagen"
        : zonaAdjuntos.current?.contains(debajo)
          ? "adjuntos"
          : null;

      // `enter` también trae las rutas, pero el archivo todavía está en el aire.
      // Solo `drop` significa que se soltó.
      if (carga.type === "enter" || carga.type === "over") {
        setEncima(destino);
        return;
      }

      setEncima(null);
      if (destino === null) return;

      if (destino === "imagen") {
        const primera = carga.paths[0];
        if (primera) setEncuadrando(primera);
        return;
      }

      estado.current.onAdjuntos([
        ...estado.current.adjuntos,
        ...carga.paths.map((origen) => ({ tipo: "nuevo" as const, origen })),
      ]);
    });

    return () => {
      void quitar.then((f) => f());
    };
  }, []);

  async function elegirImagen() {
    const elegida = await open({
      multiple: false,
      filters: [{ name: "Imágenes", extensions: FORMATOS }],
    });
    if (typeof elegida === "string") setEncuadrando(elegida);
  }

  async function elegirAdjuntos() {
    const elegidos = await open({ multiple: true });
    if (!elegidos) return;

    onAdjuntos([
      ...adjuntos,
      ...elegidos.map((origen) => ({ tipo: "nuevo" as const, origen })),
    ]);
  }

  return (
    <>
      <div className="fila-campo">
        <label>IMAGEN</label>
        <div ref={zonaImagen}>
          {imagen.tipo === "sin" ? (
            <button
              type="button"
              className={encima === "imagen" ? "campo suelta encima" : "campo suelta"}
              onClick={elegirImagen}
            >
              <span className="nombre">Arrastra una imagen o haz clic</span>
              <span className="mas">+</span>
            </button>
          ) : (
            <div
              className={encima === "imagen" ? "elegido encima" : "elegido"}
            >
              <Vista carpeta={carpeta} imagen={imagen} muestra={muestra} />
              <span className="nombre">{nombreDeImagen(imagen)}</span>
              <button
                type="button"
                className="quitar"
                onClick={() => {
                  onImagen({ tipo: "sin" });
                  setMuestra(null);
                }}
                title="Quitar la imagen"
              >
                ✕
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="fila-campo">
        <label>ARCHIVOS</label>
        <div ref={zonaAdjuntos} className="lista-archivos">
          {adjuntos.map((adjunto, i) => (
            <div className="elegido" key={claveDe(adjunto, i)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
              <span className="nombre">{nombreDeAdjunto(adjunto)}</span>
              {adjunto.tipo === "guardado" && (
                <span className="peso">{tamanoLegible(adjunto.tamano)}</span>
              )}
              <button
                type="button"
                className="quitar"
                onClick={() => onAdjuntos(adjuntos.filter((_, j) => j !== i))}
                title="Quitar el archivo"
              >
                ✕
              </button>
            </div>
          ))}

          <button
            type="button"
            className={
              encima === "adjuntos" ? "campo suelta encima" : "campo suelta"
            }
            onClick={elegirAdjuntos}
          >
            <span className="nombre">Arrastra archivos o haz clic</span>
            <span className="mas">+</span>
          </button>
        </div>
      </div>

      {encuadrando && (
        <Encuadre
          origen={encuadrando}
          onCerrar={() => setEncuadrando(null)}
          onElegir={(recorte, vista) => {
            onImagen({ tipo: "nueva", origen: encuadrando, recorte });
            setMuestra(vista);
            setEncuadrando(null);
          }}
        />
      )}
    </>
  );
}

/**
 * La miniatura de la imagen elegida.
 *
 * Una que ya está guardada se pide a la carpeta de datos. Una recién elegida no
 * está en ninguna carpeta todavía, así que se usa lo que devolvió el encuadre,
 * que es esa misma imagen ya recortada.
 */
function Vista({
  carpeta,
  imagen,
  muestra,
}: {
  carpeta: string;
  imagen: ImagenPedida;
  muestra: string | null;
}) {
  if (imagen.tipo === "guardada") {
    return (
      <img className="mini" src={urlDeArchivo(carpeta, imagen.miniatura)} alt="" />
    );
  }

  if (imagen.tipo === "nueva" && muestra) {
    return <img className="mini" src={muestra} alt="" />;
  }

  return <span className="mini vacia" />;
}

/** El nombre del archivo dentro de una ruta, sin importar el separador. */
function nombreDeRuta(ruta: string): string {
  const partes = ruta.split(/[\\/]/);
  return partes[partes.length - 1] ?? ruta;
}

function nombreDeImagen(imagen: ImagenPedida): string {
  if (imagen.tipo === "nueva") return nombreDeRuta(imagen.origen);
  if (imagen.tipo === "guardada") return "Imagen del evento";
  return "";
}

function nombreDeAdjunto(adjunto: AdjuntoPedido): string {
  return adjunto.tipo === "guardado"
    ? adjunto.nombre_original
    : nombreDeRuta(adjunto.origen);
}

/** Dos archivos con el mismo nombre pueden convivir, así que la posición entra. */
function claveDe(adjunto: AdjuntoPedido, i: number): string {
  return `${i}-${adjunto.tipo === "guardado" ? adjunto.ruta : adjunto.origen}`;
}
