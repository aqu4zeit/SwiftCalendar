// Cálculo de la cuadrícula y formatos de fecha visibles.
//
// Los nombres de meses y días son propios y no salen de `Intl`. `Intl` devuelve
// cosas distintas según la máquina y la versión del motor, y acá el texto es
// parte del diseño, no del sistema.

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const MESES_CORTOS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

/** Empieza en lunes, como el resto del calendario. */
const DIAS = [
  "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo",
];

const DIAS_CORTOS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

export const CABECERA_SEMANA = DIAS_CORTOS.map((d) => d.toUpperCase());

/** El día de la semana con lunes en 0, que es como se ordena la cuadrícula. */
function indiceSemana(fecha: Date): number {
  return (fecha.getDay() + 6) % 7;
}

function mayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function dosDigitos(n: number): string {
  return n.toString().padStart(2, "0");
}

/** `AAAA-MM-DD`. Es la clave con la que el lado nativo agrupa por día. */
export function clave(fecha: Date): string {
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

export function mismoDia(a: Date, b: Date): boolean {
  return clave(a) === clave(b);
}

/** `Agosto 2026`. El selector de la barra superior. */
export function mesYAnio(anio: number, mes: number): string {
  return `${mayuscula(MESES[mes - 1])} ${anio}`;
}

/**
 * `Lunes 12 de agosto`. Forma larga, para encabezados que se leen como prosa:
 * la barra superior y la vista día.
 */
export function fechaLarga(fecha: Date): string {
  const dia = DIAS[indiceSemana(fecha)];
  return `${mayuscula(dia)} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`;
}

/**
 * `mié 12 ago 2026`. Forma compacta, para donde la fecha compite por espacio:
 * panel de notificaciones y ficha del evento.
 */
export function fechaCompacta(fecha: Date): string {
  const dia = DIAS_CORTOS[indiceSemana(fecha)];
  return `${dia} ${fecha.getDate()} ${MESES_CORTOS[fecha.getMonth()]} ${fecha.getFullYear()}`;
}

/**
 * Los 42 días que dibuja la vista mes.
 *
 * Siempre seis filas, aunque el mes ocupe cinco: así el tamaño de la celda no
 * cambia al navegar entre meses. Empieza en el lunes anterior o igual al día 1,
 * y se rellena con los días de los meses vecinos.
 */
export function rejilla(anio: number, mes: number): Date[] {
  const primero = new Date(anio, mes - 1, 1);
  const inicio = new Date(anio, mes - 1, 1 - indiceSemana(primero));

  return Array.from(
    { length: 42 },
    (_, i) =>
      new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i),
  );
}

/**
 * El lunes de la semana de una fecha.
 *
 * La marca de la semana actual es de ubicación, no de contenido: depende solo de
 * qué día es hoy, nunca de qué eventos haya adentro.
 */
export function lunesDeLaSemana(fecha: Date): Date {
  return new Date(
    fecha.getFullYear(),
    fecha.getMonth(),
    fecha.getDate() - indiceSemana(fecha),
  );
}
