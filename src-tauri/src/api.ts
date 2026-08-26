// El único archivo que habla con el lado nativo.
//
// Los nombres de los campos son los mismos que en Rust, sin traducir. Renombrar
// a camelCase agregaría una capa que hay que mantener sincronizada a mano, y el
// primer campo que se olvide falla en silencio.
//
// Las fechas son `string` y nunca `Date`. Convertirlas a `Date` reintroduce la
// zona horaria del navegador en un proyecto que ya resolvió las zonas en Rust.

import { invoke } from "@tauri-apps/api/core";

export type Importancia = "comun" | "importante" | "urgente";

export interface Grupo {
  id: number;
  nombre: string;
  color: string;
  orden: number;
  es_default: boolean;
}

/** Un evento resuelto, en un día concreto. Formato `AAAA-MM-DD HH:MM`. */
export interface Instancia {
  evento_id: number;
  ocurrencia: string;
  titulo: string;
  descripcion: string | null;
  miniatura: string | null;
  grupo_id: number;
  color: string;
  orden_grupo: number;
  importancia: Importancia;
  inicio: string;
  fin: string | null;
  todo_el_dia: boolean;
  dia: number;
  de: number;
}

/** Listas explícitas de lo que se muestra. Vacía significa vacía. */
export interface Filtros {
  grupos: number[];
  importancias: Importancia[];
}

/** Los días sin eventos no aparecen. La clave es `AAAA-MM-DD`. */
export type PorDia = Record<string, Instancia[]>;

export const TODAS_LAS_IMPORTANCIAS: Importancia[] = [
  "comun",
  "importante",
  "urgente",
];

export function listarGrupos(): Promise<Grupo[]> {
  return invoke("listar_grupos");
}

export function eventosEnRango(
  desde: string,
  hasta: string,
  filtros: Filtros,
): Promise<PorDia> {
  return invoke("eventos_en_rango", { desde, hasta, filtros });
}
