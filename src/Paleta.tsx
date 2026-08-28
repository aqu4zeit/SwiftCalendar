import { useEffect, useMemo, useRef, useState } from "react";
import { useVelo } from "./flotante";

/** Una acción que la paleta puede ejecutar. */
export interface Comando {
  /** Estable, para la clave de React: el nombre cambia con el estado. */
  id: string;
  nombre: string;
  /** Cómo se escribe su atajo, si tiene. */
  atajo?: string;
}

interface Props {
  comandos: Comando[];
  /** Si es la ventana de arriba. Solo esa atiende Escape. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  onElegir: (id: string) => void;
  onCerrar: () => void;
}

/**
 * Sin acentos y en minúsculas, para que "mes" encuentre "Mes anterior" y
 * "proximo" encuentre "Mes próximo".
 */
function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * La paleta de comandos.
 *
 * Es la única pantalla que no dibuja datos del calendario: dibuja lo que se
 * puede hacer con él. Por eso los comandos llegan de afuera ya armados, con su
 * nombre resuelto según el estado — "Abrir filtros" o "Cerrar filtros"—, en vez
 * de que esta pantalla tenga que saber cómo está cada cosa.
 */
export function Paleta({ comandos, activo, saliendo, onElegir, onCerrar }: Props) {
  const [texto, setTexto] = useState("");
  const [elegido, setElegido] = useState(0);
  const lista = useRef<HTMLDivElement>(null);

  const visibles = useMemo(() => {
    const busca = plano(texto.trim());
    if (busca === "") return comandos;
    return comandos.filter((c) => plano(c.nombre).includes(busca));
  }, [comandos, texto]);

  // Al filtrar, la selección vuelve arriba: la fila que estaba elegida puede ya
  // no estar, y dejar el índice donde estaba elegiría otra cosa en silencio.
  useEffect(() => setElegido(0), [texto]);

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
      if (visibles.length === 0) return;

      const paso = evento.key === "ArrowDown" ? 1 : -1;
      // Da la vuelta: con pocas opciones, llegar al final y no poder seguir
      // obliga a recorrer la lista entera hacia atrás.
      setElegido((i) => (i + paso + visibles.length) % visibles.length);
      return;
    }

    if (evento.key === "Enter") {
      evento.preventDefault();
      const comando = visibles[elegido];
      if (comando) onElegir(comando.id);
      return;
    }

  }

  /*
   * Escape se atiende como en el resto de las ventanas: escuchando el documento
   * y mirando `activo`, la regla de la decisión 78.
   *
   * Antes lo atendía el `onKeyDown` del campo, que es otro mecanismo para lo
   * mismo, y dos mecanismos conviviendo es como una sola tecla terminaba
   * cerrando dos ventanas.
   */
  useEffect(() => {
    if (!activo) return;

    function tecla(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      evento.preventDefault();
      onCerrar();
    }

    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  });

  return (
    <div
      className={saliendo ? "velo saliendo" : "velo"}
      {...velo}
    >
      <div className="modal paleta">
        <input
          className="paleta-campo"
          type="text"
          value={texto}
          placeholder="Buscar una acción…"
          autoFocus
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={tecla}
        />

        <div className="paleta-lista" ref={lista}>
          {visibles.length === 0 && (
            <div className="paleta-vacia">Ninguna acción coincide</div>
          )}

          {visibles.map((comando, i) => (
            <button
              key={comando.id}
              type="button"
              className={i === elegido ? "paleta-fila on" : "paleta-fila"}
              data-elegido={i === elegido}
              // Con el ratón, la fila señalada es la elegida: si no, moverse con
              // el ratón y pulsar Enter ejecutaría otra cosa.
              onMouseMove={() => setElegido(i)}
              onClick={() => onElegir(comando.id)}
            >
              <span>{comando.nombre}</span>
              {comando.atajo && <kbd>{comando.atajo}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
