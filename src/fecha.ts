// Cálculo de la cuadrícula y formatos de fecha visibles.

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const MESES_CORTOS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
];

/** Empieza en lunes, como el resto del calendario. */
const DIAS = [
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
  "domingo",
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

export type FormatoHora = "12" | "24";

/** La hora de reloj de un instante `AAAA-MM-DD HH:MM`. */
export function horaDe(momento: string, formato: FormatoHora): string {
  const reloj = momento.slice(11, 16);
  if (formato === "24") return reloj;

  const [horas, minutos] = reloj.split(":");
  const h = Number(horas);
  const sufijo = h < 12 ? "AM" : "PM";
  const doce = h % 12 === 0 ? 12 : h % 12;
  return `${doce}:${minutos} ${sufijo}`;
}

/**
 * El día calendario de un `AAAA-MM-DD` o `AAAA-MM-DD HH:MM`.
 *
 * Se arma con los tres números y no analizando el texto, así que el navegador
 * no interpreta ninguna zona horaria. Sirve para saber qué día de la semana es,
 * nunca para volver a convertir una hora que el lado nativo ya resolvió.
 */
export function fechaDe(momento: string): Date {
  const [anio, mes, dia] = momento.slice(0, 10).split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

/** `AAAA-MM-DD`. Es la clave con la que el lado nativo agrupa por día. */
export function clave(fecha: Date): string {
  return `${fecha.getFullYear()}-${dosDigitos(fecha.getMonth() + 1)}-${dosDigitos(fecha.getDate())}`;
}

/** `AAAA-MM`. Es como viaja un mes por el borde. */
export function claveMes(anio: number, mes: number): string {
  return `${anio}-${dosDigitos(mes)}`;
}

export function mismoDia(a: Date, b: Date): boolean {
  return clave(a) === clave(b);
}

/** `Agosto 2026`. El selector de la barra superior. */
export function mesYAnio(anio: number, mes: number): string {
  return `${nombreMes(mes)} ${anio}`;
}

/** `Agosto`. Las filas de la lista del selector, agrupadas bajo su año. */
export function nombreMes(mes: number): string {
  return mayuscula(MESES[mes - 1]);
}

/** Los doce meses, para recorrerlos sin repetir el rango en cada llamada. */
export const MESES_DEL_ANIO = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** `Lunes 12 de agosto`. Forma larga, para encabezados. */
export function fechaLarga(fecha: Date): string {
  const dia = DIAS[indiceSemana(fecha)];
  return `${mayuscula(dia)} ${fecha.getDate()} de ${MESES[fecha.getMonth()]}`;
}

/** `lunes`. En minúscula, porque va dentro de una frase. */
export function nombreDia(fecha: Date): string {
  return DIAS[indiceSemana(fecha)];
}

function compacta(fecha: Date, conMes: boolean, conAnio: boolean): string {
  const dia = DIAS_CORTOS[indiceSemana(fecha)];
  const mes = conMes ? ` ${MESES_CORTOS[fecha.getMonth()]}` : "";
  const anio = conAnio ? ` ${fecha.getFullYear()}` : "";
  return `${dia} ${fecha.getDate()}${mes}${anio}`;
}

/** `mié 12 ago 2026`. Forma compacta, para donde falta espacio. */
export function fechaCompacta(fecha: Date): string {
  return compacta(fecha, true, true);
}

/**
 * `vie 7 al dom 9 ago 2026`. El tramo de un evento multi-día.
 *
 * El mes y el año se escriben una sola vez cuando los dos extremos coinciden.
 * Repetirlos duplica el dato que el lector ya tiene en la misma línea.
 */
export function rangoCompacto(desde: Date, hasta: Date): string {
  const mismoAnio = desde.getFullYear() === hasta.getFullYear();
  const mismoMes = mismoAnio && desde.getMonth() === hasta.getMonth();

  return `${compacta(desde, !mismoMes, !mismoAnio)} al ${compacta(hasta, true, true)}`;
}

/**
 * Los minutos de un `AAAA-MM-DD HH:MM` contra un origen fijo.
 *
 * Usa `Date.UTC` porque lo guardado es hora de reloj: un día que cambia el
 * horario de verano dura 24 horas igual, y restar en hora local daría 23.
 */
function enMinutos(momento: string): number {
  const [anio, mes, dia] = momento.slice(0, 10).split("-").map(Number);
  const [hora, minuto] = momento.slice(11, 16).split(":").map(Number);
  return Date.UTC(anio, mes - 1, dia) / 60000 + hora * 60 + minuto;
}

/** `2 horas`, `1 hora 30`, `45 minutos`. Solo para eventos con hora. */
export function duracion(inicio: string, fin: string): string {
  const total = enMinutos(fin) - enMinutos(inicio);
  const horas = Math.floor(total / 60);
  const minutos = total % 60;

  if (horas === 0) return `${minutos} minutos`;

  const cuerpo = horas === 1 ? "1 hora" : `${horas} horas`;
  return minutos === 0 ? cuerpo : `${cuerpo} ${minutos}`;
}

/** Los 42 días que dibuja la vista mes. */
export function rejilla(anio: number, mes: number): Date[] {
  const primero = new Date(anio, mes - 1, 1);
  const inicio = new Date(anio, mes - 1, 1 - indiceSemana(primero));

  return Array.from(
    { length: 42 },
    (_, i) =>
      new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate() + i),
  );
}

/** El lunes de la semana de una fecha. */
export function lunesDeLaSemana(fecha: Date): Date {
  return new Date(
    fecha.getFullYear(),
    fecha.getMonth(),
    fecha.getDate() - indiceSemana(fecha),
  );
}

/** `2026-08-12` a `12/08/2026`. */
export function aNumerica(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

/** `12/08/2026` a `2026-08-12`, o `null` si no es una fecha real. */
export function desdeNumerica(texto: string): string | null {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!partes) return null;

  const [, dia, mes, anio] = partes;
  const fecha = new Date(Number(anio), Number(mes) - 1, Number(dia));

  // Si el día no existe, el constructor lo corre al mes siguiente en silencio.
  if (
    fecha.getFullYear() !== Number(anio) ||
    fecha.getMonth() !== Number(mes) - 1 ||
    fecha.getDate() !== Number(dia)
  ) {
    return null;
  }

  return `${anio}-${mes}-${dia}`;
}

/** `HH:MM` de 24 horas, o `null`. Es la forma en que se escribe una hora. */
export function horaValida(texto: string): string | null {
  const partes = /^(\d{1,2}):(\d{2})$/.exec(texto.trim());
  if (!partes) return null;

  const horas = Number(partes[1]);
  const minutos = Number(partes[2]);
  if (horas > 23 || minutos > 59) return null;

  return `${String(horas).padStart(2, "0")}:${partes[2]}`;
}

/** Va escribiendo `12/08/2026` mientras se teclean los ocho dígitos. */
export function mascaraFecha(texto: string): string {
  const digitos = texto.replace(/\D/g, "").slice(0, 8);

  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
}

/**
 * Va escribiendo `12:45` mientras se teclean los cuatro dígitos.
 *
 * Un dígito que haría imposible la hora no entra: las 27:00 no existen, así que
 * el campo no las acepta en vez de aceptarlas y marcarlas mal después.
 */
export function mascaraHora(texto: string): string {
  let digitos = "";

  for (const d of texto.replace(/\D/g, "")) {
    const tentativa = digitos + d;

    if (tentativa.length === 2 && Number(tentativa) > 23) continue;
    if (tentativa.length === 3 && Number(d) > 5) continue;
    if (tentativa.length > 4) break;

    digitos = tentativa;
  }

  if (digitos.length <= 2) return digitos;
  return `${digitos.slice(0, 2)}:${digitos.slice(2)}`;
}
