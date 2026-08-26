/** Construcción y lectura de la regla de repetición. Solo el subconjunto que el motor acepta. */

import { aNumerica } from "./fecha";

export type Frecuencia = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Final = "nunca" | "hasta" | "veces";

export interface Repeticion {
  frecuencia: Frecuencia | null;
  intervalo: number;
  final: Final;
  /** `AAAA-MM-DD`, solo si el final es "hasta". */
  hasta: string;
  /** Solo si el final es "veces". */
  veces: number;
}

export const SIN_REPETICION: Repeticion = {
  frecuencia: null,
  intervalo: 1,
  final: "nunca",
  hasta: "",
  veces: 10,
};

export const FRECUENCIAS: {
  valor: Frecuencia;
  texto: string;
  unidad: string;
  singular: string;
}[] = [
  { valor: "DAILY", texto: "Cada día", unidad: "días", singular: "día" },
  { valor: "WEEKLY", texto: "Cada semana", unidad: "semanas", singular: "semana" },
  { valor: "MONTHLY", texto: "Cada mes", unidad: "meses", singular: "mes" },
  { valor: "YEARLY", texto: "Cada año", unidad: "años", singular: "año" },
];

/** `null` si el evento no se repite. */
export function aRrule(r: Repeticion): string | null {
  if (r.frecuencia === null) return null;

  const partes = [`FREQ=${r.frecuencia}`];
  if (r.intervalo > 1) partes.push(`INTERVAL=${r.intervalo}`);

  // UNTIL y COUNT no pueden ir juntos, así que el final es una sola elección.
  if (r.final === "hasta" && r.hasta !== "") {
    partes.push(`UNTIL=${r.hasta.replaceAll("-", "")}`);
  }
  if (r.final === "veces") {
    partes.push(`COUNT=${r.veces}`);
  }

  return partes.join(";");
}

/** Si el final elegido todavía no tiene su dato, la regla no se puede guardar. */
export function repeticionCompleta(r: Repeticion): boolean {
  if (r.frecuencia === null) return true;
  if (r.intervalo < 1) return false;
  if (r.final === "hasta") return r.hasta !== "";
  if (r.final === "veces") return r.veces >= 1;
  return true;
}

/**
 * Lee una regla guardada.
 *
 * No valida: lo que está en la base ya pasó por el analizador de Rust, que es
 * quien rechaza lo que está fuera del subconjunto. Una segunda validación acá
 * sería un segundo criterio que puede desviarse del primero.
 */
export function desdeRrule(texto: string): Repeticion {
  const partes = new Map(
    texto
      .split(";")
      .filter((p) => p !== "")
      .map((p) => {
        const [clave, valor] = p.split("=");
        return [clave.toUpperCase(), valor] as const;
      }),
  );

  const hasta = partes.get("UNTIL");
  const veces = partes.get("COUNT");

  return {
    frecuencia: (partes.get("FREQ") ?? null) as Frecuencia | null,
    intervalo: Number(partes.get("INTERVAL") ?? 1),
    final: hasta ? "hasta" : veces ? "veces" : "nunca",
    hasta: hasta
      ? `${hasta.slice(0, 4)}-${hasta.slice(4, 6)}-${hasta.slice(6, 8)}`
      : "",
    veces: veces ? Number(veces) : 10,
  };
}

/** `cada semana`, `cada 2 semanas, 10 veces`. Lo que muestra la ficha. */
export function textoRepeticion(r: Repeticion): string {
  const f = FRECUENCIAS.find((x) => x.valor === r.frecuencia);
  if (!f) return "";

  const cada =
    r.intervalo > 1 ? `cada ${r.intervalo} ${f.unidad}` : `cada ${f.singular}`;

  if (r.final === "veces") return `${cada}, ${r.veces} veces`;
  if (r.final === "hasta" && r.hasta !== "") {
    return `${cada}, hasta el ${aNumerica(r.hasta)}`;
  }
  return cada;
}

/** El inicio de la ocurrencia siguiente, para saber si la serie se pisa a sí misma. */
function proximaOcurrencia(inicio: Date, r: Repeticion): Date {
  const a = inicio.getFullYear();
  const m = inicio.getMonth();
  const d = inicio.getDate();

  switch (r.frecuencia) {
    case "DAILY":
      return new Date(a, m, d + r.intervalo);
    case "WEEKLY":
      return new Date(a, m, d + r.intervalo * 7);
    case "MONTHLY":
      return new Date(a, m + r.intervalo, d);
    default:
      return new Date(a + r.intervalo, m, d);
  }
}

/** Verdadero si el evento dura tanto que una ocurrencia alcanza a la siguiente. */
export function seSolapaConsigoMismo(
  fechaInicio: string,
  fechaFin: string,
  horaFin: string,
  todoElDia: boolean,
  r: Repeticion,
): boolean {
  if (r.frecuencia === null || fechaInicio === "" || fechaFin === "")
    return false;

  const inicio = new Date(`${fechaInicio}T00:00:00`);
  const fin = new Date(`${fechaFin}T00:00:00`);

  // Terminar a las 00:00 pertenece al día anterior, salvo en todo el día.
  const ultimo =
    !todoElDia && horaFin === "00:00" && fin > inicio
      ? new Date(fin.getFullYear(), fin.getMonth(), fin.getDate() - 1)
      : fin;

  return ultimo >= proximaOcurrencia(inicio, r);
}
