import { useState, type ReactNode } from "react";

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
  const [arrastrado, setArrastrado] = useState<number | null>(null);

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

  /** Saca el arrastrado de su sitio y lo mete en el nuevo. */
  function soltarSobre(destino: number) {
    if (arrastrado === null || arrastrado === destino) return;

    const ids = grupos.todos.map((g) => g.id);
    const [movido] = ids.splice(arrastrado, 1);
    ids.splice(destino, 0, movido);

    setArrastrado(null);
    onReordenar(ids);
  }

  return (
    <div className={saliendo ? "panel-filtros saliendo" : "panel-filtros"}>
      <h2>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16M7 12h10M10 19h4" />
        </svg>
        FILTROS
      </h2>

      <div className="grupo-titulo">GRUPOS</div>
      {grupos.todos.map((g, indice) => (
        <div
          key={g.id}
          className={
            arrastrado === indice ? "fila-grupo arrastrando" : "fila-grupo"
          }
          draggable
          onDragStart={() => setArrastrado(indice)}
          onDragEnd={() => setArrastrado(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => soltarSobre(indice)}
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
            title={`Editar ${g.nombre}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
            </svg>
          </button>

          <span className="asa" title="Arrastrar para reordenar">
            ⠿
          </span>
        </div>
      ))}

      <button type="button" className="nuevo-grupo" onClick={onNuevoGrupo}>
        Nuevo grupo <span>+</span>
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
