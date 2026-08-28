// El único archivo que habla con el lado nativo.

import { convertFileSrc, invoke } from "@tauri-apps/api/core";

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
/** El rectángulo que se conserva de la imagen, en fracciones de 0 a 1. */
export interface Recorte {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

export type ImagenPedida =
  | { tipo: "sin" }
  | { tipo: "guardada"; original: string; miniatura: string }
  | { tipo: "nueva"; origen: string; recorte: Recorte | null };

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
  /**
   * El identificador que traía un archivo `.calev` importado.
   *
   * Un evento importado adopta el del archivo en vez de recibir uno nuevo: es el
   * mismo evento, y es lo que permite avisar la próxima vez que se importe.
   */
  uid?: string;
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

export type Tema = "oscuro" | "claro";

export function listarAjustes(): Promise<Ajustes> {
  return invoke("listar_ajustes");
}

/**
 * Escribe un ajuste que ya existe y lo deja aplicado.
 *
 * La clave tiene que haber nacido en una migración: el lado nativo rechaza una
 * que no conozca en vez de guardarla para que nadie la lea nunca.
 */
export function guardarAjuste(clave: string, valor: string): Promise<void> {
  return invoke("guardar_ajuste", { clave, valor });
}

/**
 * La carpeta de datos, en absoluto. Se pide una vez al arrancar.
 *
 * Lo guardado es siempre relativo a esta carpeta, así que mostrar un archivo
 * necesita las dos partes.
 */
export function carpetaDeDatos(): Promise<string> {
  return invoke("carpeta_de_datos");
}

/**
 * Una versión reducida de la imagen elegida, para encuadrarla antes de guardar.
 *
 * Vuelve como texto porque el archivo está fuera de la carpeta de datos y el
 * protocolo de archivos no lo sirve. De paso comprueba que el archivo cabe.
 */
export function vistaPreviaImagen(origen: string): Promise<string> {
  return invoke("vista_previa_imagen", { origen });
}

/** La dirección con la que la interfaz puede pedir un archivo de la carpeta. */
export function urlDeArchivo(carpeta: string, relativa: string): string {
  return convertFileSrc(`${carpeta}/${relativa}`);
}

/** El tamaño de un archivo, tal como se muestra. */
export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

/** Una notificación tal como la muestra el panel. */
export interface Aviso {
  id: number;
  evento_id: number;
  titulo: string;
  grupo_id: number;
  importancia: Importancia;
  /** La ocurrencia que la originó. */
  ocurrencia: string;
  /** Cuándo debía aparecer. */
  momento: string;
  vista: boolean;
}

/**
 * Genera lo que faltaba desde la última pasada y devuelve cuántas nacieron.
 *
 * La interfaz lo llama al arrancar. Mientras la app vive, el temporizador nativo
 * hace lo mismo cada minuto y avisa por su cuenta.
 */
export function generarNotificaciones(): Promise<number> {
  return invoke("generar_notificaciones");
}

/**
 * La instancia de una ocurrencia, para abrir su ficha desde una notificación.
 *
 * El aviso guarda el evento y la fecha; la ficha necesita el tramo ya resuelto.
 * Buscarla entre los eventos del mes cargado no sirve: la ocurrencia puede caer
 * en otro mes.
 */
export function instanciaDe(
  evento_id: number,
  ocurrencia: string,
): Promise<Instancia> {
  return invoke("instancia_de", { eventoId: evento_id, ocurrencia });
}

export function listarNotificaciones(): Promise<Aviso[]> {
  return invoke("listar_notificaciones");
}

export function contarPendientes(): Promise<number> {
  return invoke("contar_pendientes");
}

export function marcarVista(id: number): Promise<void> {
  return invoke("marcar_vista", { id });
}

/** Devuelve cuántas pendientes había. */
export function marcarTodasVistas(): Promise<number> {
  return invoke("marcar_todas_vistas");
}

/**
 * Borra una notificación ya vista.
 *
 * Solo las vistas: una pendiente todavía no la miró nadie, y poder borrarla
 * desde la lista permitiría descartarla sin leerla de un clic mal puesto.
 */
export function borrarNotificacion(id: number): Promise<void> {
  return invoke("borrar_notificacion", { id });
}

/** Borra todas las vistas y devuelve cuántas eran. */
export function borrarNotificacionesVistas(): Promise<number> {
  return invoke("borrar_notificaciones_vistas");
}

/*
 * El menú de la bandeja. PROTOTIPO DE LA INVESTIGACIÓN.
 *
 * Vive en su propia ventana, así que necesita pedir por su cuenta lo que el
 * calendario ya tiene cargado.
 */

/** Cierra la ventana del menú sin hacer nada más. */
export function cerrarMenuBandeja(): Promise<void> {
  return invoke("cerrar_menu_bandeja");
}

/** Abre el calendario y cierra el menú. Con `avisos`, además abre el panel. */
export function abrirCalendario(avisos: boolean): Promise<void> {
  return invoke("abrir_calendario", { avisos });
}

/** Termina la aplicación. */
export function salir(): Promise<void> {
  return invoke("salir");
}

/** El aviso que pide abrir el panel de recordatorios al llegar desde la bandeja. */
export const PIDEN_AVISOS = "bandeja://avisos";

/*
 * El menú de la bandeja.
 *
 * Vive en su propia ventana y no sabe qué entradas hay: las recibe armadas del
 * lado nativo y devuelve la que se apretó, igual que el menú del clic derecho.
 */

/** Una entrada del menú, tal como la manda el lado nativo. */
export interface EntradaBandeja {
  /** Estable. Es lo que se devuelve al elegirla. */
  id: string;
  texto: string;
  /** Un punto de color delante, para lo que pide que lo miren. */
  marca: boolean;
  /** Lo que no se puede deshacer se dibuja aparte. */
  malo: boolean;
  /** Una línea encima, para separarla de lo anterior. */
  separada: boolean;
}

export function entradasDelMenu(): Promise<EntradaBandeja[]> {
  return invoke("entradas_del_menu");
}

/** Ejecuta lo elegido. `cerrar` solo aparta el menú. */
export function elegirDelMenu(id: string): Promise<void> {
  return invoke("elegir_del_menu", { id });
}

/** El aviso que recibe el menú para volver a armarse al despertar. */
export const REARMAR = "bandeja://rearmar";

/** El aviso que pide abrir un panel al llegar desde el menú de la bandeja. */
export const PIDEN_PANEL = "bandeja://panel";

/** El aviso que emite el temporizador nativo cuando nacen notificaciones. */
export const NACIERON = "notificaciones://nuevas";

/**
 * Vuelve a dibujar el ícono de la bandeja desde la base.
 *
 * Va después de cualquier cosa que mueva la cuenta de pendientes. No recibe la
 * cuenta: el ícono se dibuja desde la misma fuente que alimenta al temporizador,
 * así que no puede quedar contando algo distinto de lo que muestra la campana.
 */
export function refrescarBandeja(): Promise<void> {
  return invoke("refrescar_bandeja");
}

/**
 * Destruye la ventana y deja la aplicación viva en la bandeja.
 *
 * La promesa no alcanza a resolverse: quien la esperaría se va con la ventana.
 */
export function esconderEnBandeja(): Promise<void> {
  return invoke("esconder_en_bandeja");
}

/** El aviso con que el lado nativo consulta antes de esconder la ventana. */
export const PIDEN_ESCONDER = "bandeja://esconder";

/** Un evento tal como viaja dentro de un archivo `.calev`. */
export interface Calev {
  calev: number;
  uid: string;
  titulo: string;
  inicio: string;
  fin: string | null;
  cuando: Cuando;
  zona_origen?: string;
  importancia: Importancia;
  descripcion?: string;
  ubicacion?: string;
  url?: string;
  rrule?: string;
}

/** Lo leído de un archivo, con lo que la pantalla necesita antes de crear nada. */
export interface Importado extends Calev {
  /** Si ya hay un evento con este identificador. */
  duplicado: boolean;
  /** La imagen ya dejada en disco, para tratarla como una recién elegida. */
  imagen_ruta: string | null;
}

/** Escribe el `.calev` del evento en la ruta que eligió el usuario. */
export function exportarEvento(id: number, ruta: string): Promise<void> {
  return invoke("exportar_evento", { id, ruta });
}

/** Lee un `.calev`. No crea nada: eso lo hace el formulario al guardar. */
export function leerCalev(ruta: string): Promise<Importado> {
  return invoke("leer_calev", { ruta });
}

/**
 * Deshace la última acción. `false` si no había nada que deshacer.
 *
 * El historial vive en el lado nativo y cubre la sesión: al salir se descarta.
 */
export function deshacer(): Promise<boolean> {
  return invoke("deshacer");
}

/** Rehace lo último deshecho. `false` si no había nada. */
export function rehacer(): Promise<boolean> {
  return invoke("rehacer");
}

/**
 * Un evento guardado, tal como lo lista el panel de control.
 *
 * No es una instancia: una serie es una sola fila, con su regla, igual que en la
 * base. La consulta de rango contesta la otra pregunta —qué cae cada día— y pide
 * dos fechas que acá no existen.
 */
export interface Resumen {
  evento_id: number;
  titulo: string;
  grupo_id: number;
  grupo: string;
  color: string;
  importancia: Importancia;
  /** La ocurrencia que esta fila representa, en hora guardada. Abre su ficha. */
  ocurrencia: string;
  inicio: string;
  fin: string | null;
  todo_el_dia: boolean;
  rrule: string | null;
}

/** Una página del buscador: un mes, sus eventos y los meses vecinos. */
export interface Pagina {
  /** `AAAA-MM`. */
  mes: string;
  eventos: Resumen[];
  /** `null` es que no hay: es lo que apaga cada flecha. */
  anterior: string | null;
  siguiente: string | null;
}

/**
 * La página del buscador para un mes, filtrada por lo que se haya escrito.
 *
 * `null` significa que no coincide ningún evento. El mes que vuelve puede no ser
 * el pedido: si ese no tiene nada, se devuelve el más cercano que sí.
 */
export function paginaBuscador(
  mes: string,
  busca: string,
): Promise<Pagina | null> {
  return invoke("pagina_buscador", { mes, busca });
}

/** Todos los eventos guardados, del más antiguo al más nuevo. */
export function listarEventos(): Promise<Resumen[]> {
  return invoke("listar_eventos");
}

/**
 * Borra todos los eventos y devuelve cuántos borró.
 *
 * Entra al historial como una sola acción: un `Ctrl+Z` los devuelve todos.
 */
export function borrarTodos(): Promise<number> {
  return invoke("borrar_todos");
}

/** Empaqueta la carpeta de datos entera en el archivo elegido. */
export function exportarRespaldo(ruta: string): Promise<void> {
  return invoke("exportar_respaldo", { ruta });
}

/**
 * Deja un respaldo listo y cierra la aplicación.
 *
 * No lo aplica: la base está abierta. Se pone en su sitio en el próximo
 * arranque, antes de abrirla. La promesa no alcanza a resolverse.
 */
export function restaurarRespaldo(ruta: string): Promise<void> {
  return invoke("restaurar_respaldo", { ruta });
}
