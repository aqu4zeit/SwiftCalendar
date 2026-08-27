import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  TODAS_LAS_IMPORTANCIAS,
  type Grupo,
  type Grupos,
  type Importancia,
} from "./api";

const NOMBRE_IMPORTANCIA: Record<Importancia, string> = {
  urgente: "Urgente",
  importante: "Importante",
  comun: "Común",
};

/** De más marcada a menos, como se leen en la escala. */
const ORDEN_IMPORTANCIA: Importancia[] = ["urgente", "importante", "comun"];

interface Props {
  grupos: Grupos;
  gruposActivos: number[];
  importanciasActivas: Importancia[];
  onGrupos: (ids: number[]) => void;
  onImportancias: (lista: Importancia[]) => void;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  onEditarGrupo: (grupo: Grupo) => void;
  onNuevoGrupo: () => void;
  /** El orden completo, ya movido. */
  onReordenar: (ids: number[]) => void;
}

/**
 * Las casillas de grupo y de importancia.
 *
 * Filtrar solo esconde: no cambia ni la apariencia ni la posición de lo que
 * queda visible. Los dos ejes se combinan, así que un evento se ve si su grupo
 * y su importancia están marcados.
 */
export function PanelFiltros({
  grupos,
  gruposActivos,
  importanciasActivas,
  onGrupos,
  onImportancias,
  saliendo,
  onEditarGrupo,
  onNuevoGrupo,
  onReordenar,
}: Props) {
  /*
   * El orden mientras se arrastra.
   *
   * `null` cuando nadie arrastra: la lista que manda es la de la base. Durante el
   * arrastre vive acá para que las filas se muevan bajo el dedo sin ir y volver
   * del disco en cada píxel.
   */
  const [orden, setOrden] = useState<number[] | null>(null);
  const [tomado, setTomado] = useState<number | null>(null);
  const lista = useRef<HTMLDivElement>(null);

  // Dónde estaba cada fila en el render anterior, para poder deslizarla.
  const nodos = useRef(new Map<number, HTMLDivElement>());
  const antes = useRef(new Map<number, number>());

  function alternarGrupo(id: number) {
    onGrupos(
      gruposActivos.includes(id)
        ? gruposActivos.filter((g) => g !== id)
        : [...gruposActivos, id],
    );
  }

  function alternarImportancia(valor: Importancia) {
    onImportancias(
      importanciasActivas.includes(valor)
        ? importanciasActivas.filter((i) => i !== valor)
        : [...importanciasActivas, valor],
    );
  }

  /*
   * El reordenamiento va con eventos de puntero, no con el arrastre del
   * navegador.
   *
   * La webview de Tauri desactiva su API de arrastre para poder entregar las
   * rutas de los archivos que se sueltan encima, que es lo que necesitan la
   * imagen y los adjuntos. Así que `draggable` y `onDrop` no llegan nunca.
   */
  useEffect(() => {
    if (tomado === null) return;

    function mover(e: MouseEvent) {
      const caja = lista.current;
      if (!caja) return;

      const filas = caja.querySelectorAll<HTMLElement>(".fila-grupo");

      /*
       * Sobre qué fila está el puntero, medido contra el diseño y no contra lo
       * que se ve.
       *
       * El rectángulo en pantalla de una fila incluye el desplazamiento de su
       * animación, así que preguntando por él el cursor caía sobre una fila a
       * medio camino, se ordenaba otro intercambio, y ese intercambio movía las
       * filas otra vez: la lista temblaba entre dos posiciones sin parar. El
       * sitio que ocupa cada fila en el diseño solo cambia cuando cambia el
       * orden, que es lo que hace falta para decidir.
       */
      const arriba = caja.getBoundingClientRect().top - caja.offsetTop;
      const y = e.clientY - arriba;

      // Fuera de la lista no pasa nada, en vez de saltar al primero o al último.
      let destino: number | null = null;
      filas.forEach((fila, i) => {
        if (y >= fila.offsetTop && y <= fila.offsetTop + fila.offsetHeight) {
          destino = i;
        }
      });

      if (destino === null) return;

      setOrden((actual) => {
        if (!actual) return actual;

        const desde = actual.indexOf(tomado as number);
        if (desde === destino) return actual;

        const nuevo = [...actual];
        const [movido] = nuevo.splice(desde, 1);
        nuevo.splice(destino as number, 0, movido);
        return nuevo;
      });
    }

    function soltar() {
      setOrden((final) => {
        const previo = grupos.todos.map((g) => g.id);

        // Solo escribe si de verdad cambió algo: soltar sin haber movido no
        // tiene por qué tocar la base.
        if (final && final.join() !== previo.join()) {
          onReordenar(final);
          // El orden local se queda puesto hasta que llegue el de la base. Si se
          // soltara acá, entre la escritura y la relectura se dibujaría el orden
          // viejo durante un cuadro, y eso es el salto que se ve.
          return final;
        }

        return null;
      });

      setTomado(null);
    }

    document.addEventListener("mousemove", mover);
    document.addEventListener("mouseup", soltar);
    return () => {
      document.removeEventListener("mousemove", mover);
      document.removeEventListener("mouseup", soltar);
    };
    // `onReordenar` se recrea en cada render; lo que manda es qué se tomó.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tomado, grupos]);

  /*
   * Suelta el orden local cuando el de la base ya dice lo mismo.
   *
   * También si la lista cambió de contenido —un grupo creado o borrado mientras
   * tanto—: ahí el orden local describe algo que ya no existe.
   */
  useEffect(() => {
    if (!orden || tomado !== null) return;

    const ids = grupos.todos.map((g) => g.id);
    const mismoContenido =
      ids.length === orden.length && ids.every((id) => orden.includes(id));

    if (!mismoContenido || ids.join() === orden.join()) setOrden(null);
  }, [grupos, orden, tomado]);

  /*
   * Las filas se deslizan hasta su sitio nuevo en vez de saltar.
   *
   * React ya las dibujó donde van cuando esto corre, así que el truco es
   * devolverlas a donde estaban sin animación y soltarlas en el mismo cuadro:
   * el navegador anima el regreso. Medir después de pintar y antes de que se
   * vea es justo lo que hace `useLayoutEffect`.
   *
   * La medida es `offsetTop` y no el rectángulo en pantalla, porque el
   * rectángulo incluye el desplazamiento que la animación anterior está
   * aplicando. Moviendo el grupo antes de que esa animación termine, cada
   * desplazamiento se calculaba sobre una posición a medio camino y se sumaba
   * al anterior: por eso las filas salían disparadas cuanto más rápido se
   * arrastraba. `offsetTop` da el sitio que ocupa la fila en el diseño, que es
   * lo único que no cambia mientras algo se está moviendo.
   */
  useLayoutEffect(() => {
    nodos.current.forEach((nodo, id) => {
      const ahora = nodo.offsetTop;
      const previo = antes.current.get(id);
      antes.current.set(id, ahora);

      if (previo === undefined) return;

      // De dónde tiene que salir: del sitio donde se está viendo ahora mismo,
      // no del que ocupaba en el diseño anterior. Si la fila venía a mitad de
      // camino, salir del otro la haría dar un tirón hacia atrás antes de
      // arrancar.
      const desplazada = previo + trasladoActual(nodo) - ahora;
      if (Math.abs(desplazada) < 0.5) return;

      nodo.style.transition = "none";
      nodo.style.transform = `translateY(${desplazada}px)`;

      // Pedir una medida obliga al navegador a resolver el estilo de arriba en
      // este instante. Sin esta línea funde los dos cambios en uno solo, la
      // transición se queda sin punto de partida y la fila salta.
      void nodo.offsetHeight;

      nodo.style.transition = "";
      nodo.style.transform = "";
    });

    // Los grupos que ya no están dejan de ocupar sitio en los dos registros.
    const vivos = new Set(grupos.todos.map((g) => g.id));
    nodos.current.forEach((_, id) => {
      if (!vivos.has(id)) {
        nodos.current.delete(id);
        antes.current.delete(id);
      }
    });
  });

  function tomar(id: number) {
    setOrden(grupos.todos.map((g) => g.id));
    setTomado(id);
  }

  // Mientras se arrastra manda el orden local; el resto del tiempo, la base.
  const enOrden = orden
    ? orden.flatMap((id) => grupos.todos.filter((g) => g.id === id))
    : grupos.todos;

  return (
    <div className={saliendo ? "panel-filtros saliendo" : "panel-filtros"}>
      <h2>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16M7 12h10M10 19h4" />
        </svg>
        FILTROS
      </h2>

      <div className="grupo-titulo">GRUPOS</div>
      <div ref={lista}>
        {enOrden.map((g) => (
          <div
            key={g.id}
            /* Solo el nodo. Las posiciones no se tocan acá: esta función se
               escribe dentro del JSX, así que React la ve nueva en cada render
               y la llama con `null` antes de volver a darle el elemento. Borrar
               la posición ahí la dejaba sin punto de partida y la fila saltaba
               en vez de deslizarse. */
            ref={(nodo) => {
              if (nodo) nodos.current.set(g.id, nodo);
            }}
            className={
              tomado === g.id ? "fila-grupo arrastrando" : "fila-grupo"
            }
          >
            <Casilla
              marcada={gruposActivos.includes(g.id)}
              onAlternar={() => alternarGrupo(g.id)}
              etiqueta={g.nombre}
            >
              <span className="swatch" style={{ background: g.color }} />
            </Casilla>

            <button
              type="button"
              className="editar-grupo"
              onClick={() => onEditarGrupo(g)}
              data-texto={`Editar ${g.nombre}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
              </svg>
            </button>

            <span
              className="asa"
              data-texto="Arrastrar para reordenar"
              onMouseDown={(e) => {
                e.preventDefault();
                tomar(g.id);
              }}
            >
              ⠿
            </span>
          </div>
        ))}
      </div>

      <button type="button" className="nuevo-grupo" onClick={onNuevoGrupo}>
        <span>Nuevo grupo</span>
        <span>+</span>
      </button>

      <div className="grupo-titulo">IMPORTANCIA</div>
      {ORDEN_IMPORTANCIA.map((valor) => (
        <Casilla
          key={valor}
          marcada={importanciasActivas.includes(valor)}
          onAlternar={() => alternarImportancia(valor)}
          etiqueta={NOMBRE_IMPORTANCIA[valor]}
        >
          {/* La misma escala de la celda, en gris: acá la barra explica la
              forma, no el grupo. */}
          <span
            className="ejemplo"
            style={
              valor === "urgente"
                ? { background: "var(--tx-2)" }
                : valor === "importante"
                  ? { borderColor: "var(--tx-2)" }
                  : undefined
            }
          />
        </Casilla>
      ))}
    </div>
  );
}

interface CasillaProps {
  marcada: boolean;
  onAlternar: () => void;
  etiqueta: string;
  children: ReactNode;
}

function Casilla({ marcada, onAlternar, etiqueta, children }: CasillaProps) {
  return (
    <button
      type="button"
      className={marcada ? "fila-filtro" : "fila-filtro apagada"}
      onClick={onAlternar}
    >
      <span className={marcada ? "box on" : "box"} />
      {children}
      <span className="etiqueta-filtro">{etiqueta}</span>
    </button>
  );
}

/** Verdadero si algo está escondido por el filtro. */
export function hayFiltroApagado(
  grupos: Grupos,
  gruposActivos: number[],
  importanciasActivas: Importancia[],
): boolean {
  return (
    gruposActivos.length < grupos.todos.length ||
    importanciasActivas.length < TODAS_LAS_IMPORTANCIAS.length
  );
}

/**
 * Cuánto tiene desplazada una fila en este instante, en píxeles.
 *
 * Durante una transición el valor calculado es el del fotograma actual, que es
 * justo lo que hace falta para continuar desde ahí en vez de reiniciar.
 */
function trasladoActual(nodo: HTMLElement): number {
  const escrito = getComputedStyle(nodo).transform;
  if (escrito === "none" || escrito === "") return 0;

  return new DOMMatrixReadOnly(escrito).m42;
}
