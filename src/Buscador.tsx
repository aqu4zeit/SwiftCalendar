import { useEffect, useRef, useState } from "react";

import { paginaBuscador, type Pagina, type Resumen } from "./api";
import { mesYAnio, type FormatoHora } from "./fecha";
import { useVelo } from "./flotante";
import { cuandoOcurre } from "./texto";

interface Props {
  /** El mes que se está viendo en el calendario. Es por donde empieza. */
  mes: string;
  formatoHora: FormatoHora;
  /** Si es la ventana de arriba. Solo esa atiende Escape. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  /** El evento elegido, con la ocurrencia a la que hay que ir. */
  onIr: (evento: Resumen) => void;
  onError: (mensaje: string) => void;
  onCerrar: () => void;
}

/**
 * Buscar un evento e ir a él.
 *
 * Hojea por meses: cada página es un mes con eventos y cada evento ocupa una
 * fila, la de la ocurrencia que representa a ese mes. Escribir no cambia la
 * forma, solo reduce lo que hay: quedan los meses donde algo coincide, y las
 * flechas se mueven entre ellos.
 *
 * Quién decide todo eso es el lado nativo, en una sola llamada por página. Acá
 * no se filtra nada: repartir el filtro entre los dos lados haría que la lista y
 * las flechas contestaran cosas distintas.
 */
export function Buscador({
  mes,
  formatoHora,
  activo,
  saliendo,
  onIr,
  onError,
  onCerrar,
}: Props) {
  const [texto, setTexto] = useState("");
  const [pagina, setPagina] = useState<Pagina | null>(null);
  const [cargando, setCargando] = useState(true);
  const [elegido, setElegido] = useState(0);
  const lista = useRef<HTMLDivElement>(null);

  /*
   * Qué página pedir.
   *
   * Es el mes que se está viendo hasta que una flecha lo mueve. Al escribir no
   * se toca: la búsqueda parte desde donde estabas, y si ahí ya no coincide
   * nada, el lado nativo devuelve el mes más cercano que sí.
   */
  const [pedido, setPedido] = useState(mes);

  useEffect(() => {
    let vigente = true;
    setCargando(true);

    paginaBuscador(pedido, texto)
      .then((traida) => {
        if (!vigente) return;
        setPagina(traida);
        setCargando(false);
        // El mes que vuelve puede no ser el pedido.
        if (traida) setPedido(traida.mes);
      })
      .catch((e: unknown) => {
        if (!vigente) return;
        setCargando(false);
        onError(String(e));
      });

    return () => {
      vigente = false;
    };
    // `onError` se recrea en cada render; lo que manda es qué se pidió.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido, texto]);

  const eventos = pagina?.eventos ?? [];

  // Al cambiar de página o de texto, la selección vuelve arriba: la fila que
  // estaba elegida puede ya no estar, y dejar el índice elegiría otra en
  // silencio.
  useEffect(() => setElegido(0), [pagina]);

  // La fila elegida con el teclado tiene que estar a la vista.
  useEffect(() => {
    lista.current
      ?.querySelector('[data-elegido="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [elegido]);

  const velo = useVelo(onCerrar);

  function tecla(evento: React.KeyboardEvent) {
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      if (eventos.length === 0) return;

      const paso = evento.key === "ArrowDown" ? 1 : -1;
      setElegido((i) => (i + paso + eventos.length) % eventos.length);
      return;
    }

    // Las flechas laterales cambian de mes: dentro del campo no mueven el
    // cursor porque lo que se escribe es corto y la página es lo que importa.
    if (evento.key === "ArrowLeft" || evento.key === "ArrowRight") {
      const destino =
        evento.key === "ArrowLeft" ? pagina?.anterior : pagina?.siguiente;
      if (!destino) return;

      evento.preventDefault();
      setPedido(destino);
      return;
    }

    if (evento.key === "Enter") {
      evento.preventDefault();
      const elegida = eventos[elegido];
      if (elegida) onIr(elegida);
    }
  }

  // Escape se atiende como en el resto de las ventanas, la regla de la
  // decisión 78: escuchando el documento y mirando `activo`.
  useEffect(() => {
    if (!activo) return;

    function atajo(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      evento.preventDefault();
      onCerrar();
    }

    document.addEventListener("keydown", atajo);
    return () => document.removeEventListener("keydown", atajo);
  });

  return (
    <div className={saliendo ? "velo saliendo" : "velo"} {...velo}>
      <div className="modal buscador">
        <input
          className="paleta-campo"
          type="text"
          value={texto}
          placeholder="Buscar un evento…"
          autoFocus
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={tecla}
        />

        {/* Mientras carga se deja lo que había: parpadear entre la lista y un
            mensaje en cada tecla se lee peor que una lista un cuadro vieja. */}
        {pagina === null ? (
          !cargando && (
            <div className="paleta-vacia">
              {texto.trim() === ""
                ? "No hay eventos guardados."
                : "Ningún evento coincide"}
            </div>
          )
        ) : (
          <>
            <div className="buscador-mes">
              <button
                type="button"
                className="buscador-flecha"
                disabled={!pagina.anterior}
                onClick={() =>
                  pagina.anterior && setPedido(pagina.anterior)
                }
                data-texto="Mes anterior con eventos"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>

              <span>{titulo(pagina.mes)}</span>

              <button
                type="button"
                className="buscador-flecha"
                disabled={!pagina.siguiente}
                onClick={() =>
                  pagina.siguiente && setPedido(pagina.siguiente)
                }
                data-texto="Mes siguiente con eventos"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            <div className="paleta-lista" ref={lista}>
              {eventos.map((evento, i) => (
                <button
                  key={evento.evento_id}
                  type="button"
                  className={
                    i === elegido
                      ? "paleta-fila buscador-fila on"
                      : "paleta-fila buscador-fila"
                  }
                  data-elegido={i === elegido}
                  // Con el ratón, la fila señalada es la elegida: si no, moverse
                  // con el ratón y pulsar Enter llevaría a otro evento.
                  onMouseMove={() => setElegido(i)}
                  onClick={() => onIr(evento)}
                >
                  <span className="dot" style={{ background: evento.color }} />

                  <span className="buscador-txt">
                    <span className="t">{evento.titulo}</span>
                    <span className="h">
                      {cuandoOcurre(evento, formatoHora)}
                    </span>
                  </span>

                  <span className="buscador-grupo">{evento.grupo}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** `2026-08` como `Agosto 2026`. */
function titulo(mes: string): string {
  const [anio, numero] = mes.split("-").map(Number);
  return mesYAnio(anio, numero);
}
