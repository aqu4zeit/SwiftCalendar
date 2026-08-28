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
import { useListaConSalida, usePresencia } from "./presencia";

/** Los formatos que sabe decodificar el lado nativo. */
const FORMATOS = ["png", "jpg", "jpeg", "gif", "bmp", "webp"];

interface Props {
  carpeta: string;
  imagen: ImagenPedida;
  onImagen: (imagen: ImagenPedida) => void;
  adjuntos: AdjuntoPedido[];
  onAdjuntos: (adjuntos: AdjuntoPedido[]) => void;
  /**
   * Una imagen que ya está en disco y hay que encuadrar al abrir.
   *
   * La usa el formulario cuando viene de importar un archivo `.calev`. Entra por
   * el mismo diálogo de encuadre que cualquier imagen elegida a mano: darle el
   * valor ya hecho se saltaría el recorte y la previa, que nacen ahí.
   */
  imagenInicial?: string;
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
  imagenInicial,
}: Props) {
  const zonaImagen = useRef<HTMLDivElement>(null);
  const zonaAdjuntos = useRef<HTMLDivElement>(null);
  const [encima, setEncima] = useState<"imagen" | "adjuntos" | null>(null);

  // La imagen elegida que todavía no se confirmó: primero se encuadra. Al
  // importar, la del archivo ya está esperando desde el primer render.
  const [encuadrando, setEncuadrando] = useState<string | null>(
    imagenInicial ?? null,
  );

  // Cómo quedó al encuadrarla. Una imagen recién elegida todavía no está en la
  // carpeta de datos, así que no hay archivo que pedir: esto es lo único que
  // permite verla antes de guardar el evento.
  const [muestra, setMuestra] = useState<string | null>(null);

  // El diálogo y la imagen se quedan puestos mientras se van. Sin esto React
  // los desmonta en el mismo cuadro y no alcanzan a animar la salida.
  const encuadre = usePresencia(encuadrando);
  const elegida = usePresencia(imagen.tipo === "sin" ? null : imagen);
  const enLista = useListaConSalida(adjuntos, claveDe);

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
          {elegida.valor === null ? (
            <button
              type="button"
              className={clases("campo suelta", encima === "imagen" && "encima")}
              onClick={elegirImagen}
            >
              <span className="nombre">Arrastra una imagen o haz clic</span>
              <span className="mas">+</span>
            </button>
          ) : (
            <div
              className={clases(
                "elegido",
                encima === "imagen" && "encima",
                elegida.saliendo && "saliendo",
              )}
            >
              <Vista
                carpeta={carpeta}
                imagen={elegida.valor}
                muestra={muestra}
              />
              <span className="nombre">
                {nombreDeImagen(elegida.valor, imagenInicial)}
              </span>
              <button
                type="button"
                className="quitar"
                onClick={() => {
                  onImagen({ tipo: "sin" });
                  setMuestra(null);
                }}
                data-texto="Quitar la imagen"
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
          {enLista.map(({ item: adjunto, saliendo }) => (
            <div
              className={clases("elegido", saliendo && "saliendo")}
              key={claveDe(adjunto)}
            >
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
                onClick={() =>
                  onAdjuntos(adjuntos.filter((a) => claveDe(a) !== claveDe(adjunto)))
                }
                data-texto="Quitar el archivo"
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

      {encuadre.valor && (
        <Encuadre
          origen={encuadre.valor}
          saliendo={encuadre.saliendo}
          onCerrar={() => setEncuadrando(null)}
          onElegir={(recorte, vista) => {
            onImagen({ tipo: "nueva", origen: encuadre.valor as string, recorte });
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

/**
 * Cómo se llama la imagen en la fila.
 *
 * La elegida a mano muestra su nombre de archivo, que es lo que el usuario
 * reconoce. La importada no: viene de un archivo temporal con un nombre que no
 * significa nada para nadie, así que se nombra por lo que es.
 */
function nombreDeImagen(imagen: ImagenPedida, importada?: string): string {
  if (imagen.tipo === "guardada") return "Imagen del evento";
  if (imagen.tipo !== "nueva") return "";

  return imagen.origen === importada
    ? "Imagen del evento importado"
    : nombreDeRuta(imagen.origen);
}

function nombreDeAdjunto(adjunto: AdjuntoPedido): string {
  return adjunto.tipo === "guardado"
    ? adjunto.nombre_original
    : nombreDeRuta(adjunto.origen);
}

/**
 * La clave de un adjunto para saber cuál se fue.
 *
 * Sale del archivo y no de la posición: si dependiera del índice, quitar uno del
 * medio correría las claves de todos los siguientes y la animación de salida
 * caería en el que no era.
 */
function claveDe(adjunto: AdjuntoPedido): string {
  return adjunto.tipo === "guardado" ? adjunto.ruta : adjunto.origen;
}

/** Junta clases sin dejar espacios de las que no aplican. */
function clases(...partes: (string | false | null | undefined)[]): string {
  return partes.filter(Boolean).join(" ");
}
