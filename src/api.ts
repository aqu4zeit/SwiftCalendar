// El único archivo que habla con el lado nativo.

import { invoke } from "@tauri-apps/api/core";

export type Importancia = "comun" | "importante" | "urgente";

/** Qué significa la hora del evento. */
export type Cuando = "todo_el_dia" | "fija" | "adaptable";

export interface Grupo {
  id: number;
  nombre: string;
  color: string;
  orden: number;
  es_default: boolean;
}

/**
 * Los grupos con el de por defecto ya resuelto.
 *
 * El formulario necesita uno para partir. Buscarlo dentro de una lista que
 * podría venir vacía deja la garantía en manos de quien llama; acá la sostiene
 * el tipo, y la lista vacía deja de ser un estado posible.
 */
export interface Grupos {
  porDefecto: Grupo;
  todos: Grupo[];
}

/** `null` si todavía no hay ninguno, que solo ocurre antes de la primera carga. */
export function agruparGrupos(lista: Grupo[]): Grupos | null {
  const porDefecto = lista.find((g) => g.es_default);
  if (!porDefecto) return null;

  return { porDefecto, todos: lista };
}

/** Un evento resuelto, en un día concreto. Formato `AAAA-MM-DD HH:MM`. */
export interface Instancia {
  evento_id: number;
  /** La hora guardada, sin resolver. Es la clave de las excepciones. */
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

/** Un archivo colgado del evento, tal como está guardado. */
export interface AdjuntoDetalle {
  ruta: string;
  nombre_original: string;
  tamano: number;
  /** Falso si el archivo ya no está en la carpeta. */
  existe: boolean;
}

/**
 * Un evento tal como está guardado.
 *
 * La instancia dice cuándo ocurre este día; esto dice qué es el evento. Son los
 * campos que la consulta de rango no lleva porque la celda no los dibuja.
 */
export interface EventoDetalle {
  id: number;
  grupo_id: number;
  titulo: string;
  inicio: string;
  fin: string | null;
  cuando: Cuando;
  importancia: Importancia;
  descripcion: string | null;
  ubicacion: string | null;
  url: string | null;
  imagen: string | null;
  miniatura: string | null;
  /** Falso si el archivo ya no está en la carpeta. */
  imagen_existe: boolean;
  adjuntos: AdjuntoDetalle[];
  rrule: string | null;
  recordatorio_min: number | null;
}

/** Con qué abre el formulario cuando edita en vez de crear. */
export interface Edicion {
  detalle: EventoDetalle;
  /** La ocurrencia a separar de su serie, o `null` para toda la serie. */
  ocurrencia: string | null;
  /** Las fechas con las que se precarga. Dependen del alcance elegido. */
  inicio: string;
  fin: string | null;
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

/**
 * Qué imagen tiene que quedar guardada.
 *
 * Las tres formas son estados distintos. Con una ruta opcional habría que
 * adivinar si es la que ya estaba o una nueva por copiar.
 */
export type ImagenPedida =
  | { tipo: "sin" }
  | { tipo: "guardada"; original: string; miniatura: string }
  | { tipo: "nueva"; origen: string };

/** Las mismas formas del adjunto, menos "sin": eso es la lista vacía. */
export type AdjuntoPedido =
  | {
      tipo: "guardado";
      ruta: string;
      nombre_original: string;
      tamano: number;
    }
  | { tipo: "nuevo"; origen: string };

/** Lo que se manda para crear o editar un evento. */
export interface EventoNuevo {
  grupo_id: number;
  titulo: string;
  /** `AAAA-MM-DD HH:MM`. */
  inicio: string;
  fin: string | null;
  cuando: Cuando;
  importancia: Importancia;
  descripcion: string | null;
  ubicacion: string | null;
  url: string | null;
  imagen: ImagenPedida;
  /** La lista completa que tiene que quedar, no un cambio sobre la anterior. */
  adjuntos: AdjuntoPedido[];
  rrule: string | null;
  recordatorio_min: number | null;
}

/** Devuelve el identificador del evento creado. */
export function crearEvento(evento: EventoNuevo): Promise<number> {
  return invoke("crear_evento", { evento });
}

export function leerEvento(id: number): Promise<EventoDetalle> {
  return invoke("leer_evento", { id });
}

/** Con `ocurrencia` toca solo esa; con `null`, toda la serie. */
export function editarEvento(
  id: number,
  ocurrencia: string | null,
  evento: EventoNuevo,
): Promise<void> {
  return invoke("editar_evento", { id, ocurrencia, evento });
}

/** Con `ocurrencia` borra solo esa; con `null`, toda la serie. */
export function borrarEvento(
  id: number,
  ocurrencia: string | null,
): Promise<void> {
  return invoke("borrar_evento", { id, ocurrencia });
}

/** El diccionario de la tabla `ajuste`, tal cual está guardado. */
export type Ajustes = Record<string, string>;

export type Densidad = "comoda" | "compacta";

export function listarAjustes(): Promise<Ajustes> {
  return invoke("listar_ajustes");
}

export function listarGrupos(): Promise<Grupo[]> {
  return invoke("listar_grupos");
}

/** Nombre y color. El orden se mueve aparte, arrastrando. */
export interface GrupoNuevo {
  nombre: string;
  color: string;
}

/** Devuelve el identificador del grupo creado. */
export function crearGrupo(grupo: GrupoNuevo): Promise<number> {
  return invoke("crear_grupo", { grupo });
}

export function editarGrupo(id: number, grupo: GrupoNuevo): Promise<void> {
  return invoke("editar_grupo", { id, grupo });
}

/** Sus eventos se mueven al grupo por defecto; nunca se borran. */
export function borrarGrupo(id: number): Promise<void> {
  return invoke("borrar_grupo", { id });
}

/** El orden completo, no un movimiento suelto. */
export function reordenarGrupos(ids: number[]): Promise<void> {
  return invoke("reordenar_grupos", { ids });
}

export function eventosEnRango(
  desde: string,
  hasta: string,
  filtros: Filtros,
): Promise<PorDia> {
  return invoke("eventos_en_rango", { desde, hasta, filtros });
}
