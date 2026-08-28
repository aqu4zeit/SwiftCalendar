import type { Resumen } from "./api";
import {
  fechaCompacta,
  fechaDe,
  horaDe,
  mismoDia,
  rangoCompacto,
  type FormatoHora,
} from "./fecha";
import { desdeRrule, textoRepeticion } from "./rrule";

/**
 * Cómo se compara texto escrito a mano.
 *
 * Sin acentos y en minúsculas, para que "mes" encuentre "Mes anterior" y
 * "proximo" encuentre "Mes próximo". Vive aparte porque lo usan la paleta de
 * comandos y el buscador, y dos normalizaciones distintas harían que la misma
 * palabra encontrara cosas distintas según dónde se escriba.
 */
export function plano(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Cuándo empieza un evento guardado y, si se repite, cada cuánto vuelve.
 *
 * La escriben igual el panel de control y el buscador. Con una copia en cada uno
 * la misma fila diría dos cosas distintas en cuanto una de las dos cambiara.
 */
export function cuandoOcurre(evento: Resumen, formato: FormatoHora): string {
  const inicio = fechaDe(evento.inicio);
  const fin = evento.fin === null ? null : fechaDe(evento.fin);

  const partes: string[] = [
    fin && !mismoDia(inicio, fin)
      ? rangoCompacto(inicio, fin)
      : fechaCompacta(inicio),
  ];

  if (!evento.todo_el_dia) partes.push(horaDe(evento.inicio, formato));
  if (evento.rrule !== null) {
    partes.push(`se repite ${textoRepeticion(desdeRrule(evento.rrule))}`);
  }

  return partes.join(" · ");
}
