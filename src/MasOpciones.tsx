import { CampoFecha } from "./CampoFecha";
import { Desplegable } from "./Desplegable";
import {
  FRECUENCIAS,
  type Final,
  type Frecuencia,
  type Repeticion,
} from "./rrule";

/** Minutos antes del evento. `null` es sin recordatorio. */
export const RECORDATORIOS: { valor: number | null; texto: string }[] = [
  { valor: null, texto: "Sin recordatorio" },
  { valor: 0, texto: "Al momento" },
  { valor: 5, texto: "5 minutos antes" },
  { valor: 10, texto: "10 minutos antes" },
  { valor: 15, texto: "15 minutos antes" },
  { valor: 30, texto: "30 minutos antes" },
  { valor: 60, texto: "1 hora antes" },
  { valor: 120, texto: "2 horas antes" },
  { valor: 1440, texto: "1 día antes" },
  { valor: 10080, texto: "1 semana antes" },
];

const FINALES: { valor: Final; texto: string }[] = [
  { valor: "nunca", texto: "Para siempre" },
  { valor: "hasta", texto: "Hasta una fecha" },
  { valor: "veces", texto: "Después de N veces" },
];

interface Props {
  abierto: boolean;
  onAlternar: () => void;
  /** Falso al separar una ocurrencia: un evento suelto no se repite. */
  permiteRepeticion: boolean;
  repeticion: Repeticion;
  onRepeticion: (r: Repeticion) => void;
  recordatorio: number | null;
  onRecordatorio: (m: number | null) => void;
  adaptable: boolean;
  onAdaptable: (v: boolean) => void;
  todoElDia: boolean;
  ubicacion: string;
  onUbicacion: (v: string) => void;
  url: string;
  onUrl: (v: string) => void;
}

export function MasOpciones(p: Props) {
  const unidad =
    FRECUENCIAS.find((f) => f.valor === p.repeticion.frecuencia)?.unidad ?? "";

  return (
    <>
      <button type="button" className="mas-opciones" onClick={p.onAlternar}>
        <svg
          className={p.abierto ? "caret abierto" : "caret"}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
        Más opciones
      </button>

      {p.abierto && (
        <div className="bloque-opciones">
          {p.permiteRepeticion && (
            <>
              <div className="fila-campo">
                <label>REPETICIÓN</label>
                <Desplegable
                  valor={p.repeticion.frecuencia ?? ""}
                  opciones={[
                    { valor: "", texto: "No se repite" },
                    ...FRECUENCIAS.map((f) => ({
                      valor: f.valor,
                      texto: f.texto,
                    })),
                  ]}
                  onElegir={(v) =>
                    p.onRepeticion({
                      ...p.repeticion,
                      frecuencia: (v || null) as Frecuencia | null,
                    })
                  }
                />
              </div>

              {p.repeticion.frecuencia && (
                <>
                  <div className="fila-campo">
                    <label>INTERVALO</label>
                    <div className="campo">
                      <span className="fijo">Cada</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="numerito"
                        value={p.repeticion.intervalo}
                        onChange={(e) =>
                          p.onRepeticion({
                            ...p.repeticion,
                            intervalo: Number(
                              e.target.value.replace(/\D/g, "").slice(0, 3),
                            ),
                          })
                        }
                      />
                      <span className="fijo">{unidad}</span>
                    </div>
                  </div>

                  <div className="fila-campo">
                    <label>TERMINA</label>
                    <Desplegable
                      valor={p.repeticion.final}
                      opciones={FINALES.map((f) => ({
                        valor: f.valor,
                        texto: f.texto,
                      }))}
                      onElegir={(v) =>
                        p.onRepeticion({ ...p.repeticion, final: v as Final })
                      }
                    />
                  </div>

                  {p.repeticion.final === "hasta" && (
                    <div className="fila-campo">
                      <CampoFecha
                        valor={p.repeticion.hasta}
                        onCambiar={(hasta) =>
                          p.onRepeticion({ ...p.repeticion, hasta })
                        }
                      />
                    </div>
                  )}

                  {p.repeticion.final === "veces" && (
                    <div className="fila-campo">
                      <div className="campo">
                        <input
                          type="text"
                          inputMode="numeric"
                          className="numerito"
                          value={p.repeticion.veces}
                          onChange={(e) =>
                            p.onRepeticion({
                              ...p.repeticion,
                              veces: Number(
                                e.target.value.replace(/\D/g, "").slice(0, 4),
                              ),
                            })
                          }
                        />
                        <span className="fijo">repeticiones</span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <div className="fila-campo">
            <label>RECORDATORIO</label>
            <Desplegable
              valor={p.recordatorio === null ? "" : String(p.recordatorio)}
              opciones={RECORDATORIOS.map((r) => ({
                valor: r.valor === null ? "" : String(r.valor),
                texto: r.texto,
              }))}
              onElegir={(v) => p.onRecordatorio(v === "" ? null : Number(v))}
            />
          </div>

          {/* Un evento de todo el día no elige tipo de hora: un día es un día. */}
          {!p.todoElDia && (
            <div className="fila-campo">
              <label>TIPO DE HORA</label>
              <div className="segmentado">
                <button
                  type="button"
                  className={!p.adaptable ? "on" : undefined}
                  onClick={() => p.onAdaptable(false)}
                >
                  Fija
                </button>
                <button
                  type="button"
                  className={p.adaptable ? "on" : undefined}
                  onClick={() => p.onAdaptable(true)}
                >
                  Se adapta a la zona horaria
                </button>
              </div>
              <p className="nota">
                {p.adaptable
                  ? "La hora queda anclada a tu zona horaria. Si cambia el horario de verano o compartes el evento, se muestra en el momento equivalente."
                  : "Las 18:00 son las 18:00 siempre, aunque cambie el horario o compartas el evento."}
              </p>
            </div>
          )}

          <div className="fila-campo">
            <label>UBICACIÓN</label>
            <div className="campo">
              <input
                type="text"
                placeholder="Opcional"
                value={p.ubicacion}
                onChange={(e) => p.onUbicacion(e.target.value)}
              />
            </div>
          </div>

          <div className="fila-campo">
            <label>ENLACE</label>
            <div className="campo">
              <input
                type="text"
                placeholder="Opcional"
                value={p.url}
                onChange={(e) => p.onUrl(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
