import { useEffect, useId, useState } from "react";

import { borrarGrupo, crearGrupo, editarGrupo, type Grupo } from "./api";
import { usePresencia } from "./presencia";
import { alSoltarElPuntero } from "./puntero";
import { SelectorColor } from "./SelectorColor";

/** Diez colores calibrados para el fondo oscuro. */
const PALETA = [
  "#cf8f3c",
  "#c2683f",
  "#b05450",
  "#b06a8f",
  "#8f72b8",
  "#5f8fa8",
  "#4f9e8c",
  "#6da24f",
  "#a09a4f",
  "#8b857e",
];

interface Props {
  /** Ausente significa crear. */
  grupo?: Grupo;
  /** Si es la ventana de arriba. Solo esa atiende Escape. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  onCerrar: () => void;
  /** Recibe el identificador, que al crear es nuevo. */
  onGuardado: (id: number) => void;
  onBorrado: () => void;
}

export function FormularioGrupo({
  grupo,
  activo,
  saliendo,
  onCerrar,
  onGuardado,
  onBorrado,
}: Props) {
  // Enlaza cada campo con su etiqueta y cada ventana con su título, para que
  // el lector de pantalla diga qué es cada cosa.
  const id = useId();
  const [nombre, setNombre] = useState(grupo?.nombre ?? "");
  const [color, setColor] = useState(grupo?.color ?? PALETA[0]);
  const [confirmando, setConfirmando] = useState(false);
  const [preguntando, setPreguntando] = useState(false);
  // Igual que el título de un evento: se reclama después de pasar por el campo.
  const [nombreTocado, setNombreTocado] = useState(false);
  const confirmacion = usePresencia(confirmando ? true : null);
  const pregunta = usePresencia(preguntando ? true : null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hayCambios =
    nombre !== (grupo?.nombre ?? "") || color !== (grupo?.color ?? PALETA[0]);

  // Nunca se bloquea la salida: con cambios se pregunta, sin cambios se cierra.
  function intentarCerrar() {
    if (hayCambios) setPreguntando(true);
    else onCerrar();
  }

  useEffect(() => {
    if (!activo) return;

    function tecla(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      if (confirmando) setConfirmando(false);
      else if (preguntando) setPreguntando(false);
      else intentarCerrar();
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  });

  // "Otro" existe siempre y recoge los eventos de los grupos borrados.
  const esPorDefecto = grupo?.es_default === true;
  const faltaNombre = nombre.trim() === "";
  const reclamarNombre = faltaNombre && nombreTocado && !esPorDefecto;
  const sePuedeGuardar = !faltaNombre && !guardando;

  async function guardar() {
    setGuardando(true);
    try {
      const cuerpo = { nombre: nombre.trim(), color };
      if (grupo) {
        await editarGrupo(grupo.id, cuerpo);
        onGuardado(grupo.id);
      } else {
        onGuardado(await crearGrupo(cuerpo));
      }
    } catch (e: unknown) {
      setError(String(e));
      setGuardando(false);
    }
  }

  async function borrar() {
    if (!grupo) return;
    setGuardando(true);
    try {
      await borrarGrupo(grupo.id);
      onBorrado();
    } catch (e: unknown) {
      setError(String(e));
      setGuardando(false);
      setConfirmando(false);
    }
  }

  return (
    <div className={saliendo ? "velo saliendo" : "velo"}>
      <div
        className="modal angosto"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
      >
        <div className="modal-cab">
          <h2 id={`${id}-titulo`}>{grupo ? "Editar grupo" : "Nuevo grupo"}</h2>
          <button type="button" className="cerrar" aria-label="Cerrar" onClick={intentarCerrar}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div className="modal-cuerpo">
          <div className="fila-campo">
            <label htmlFor={`${id}-nombre`}>NOMBRE</label>
            <div className={reclamarNombre ? "campo malo" : "campo"}>
              <input
                id={`${id}-nombre`}
                aria-invalid={reclamarNombre}
                aria-describedby={reclamarNombre ? `${id}-falta-nombre` : undefined}
                type="text"
                value={nombre}
                placeholder="Nombre del grupo"
                onChange={(e) => {
                  setNombreTocado(true);
                  setNombre(e.target.value);
                }}
                onBlur={() => alSoltarElPuntero(() => setNombreTocado(true))}
                disabled={esPorDefecto}
                autoFocus={!esPorDefecto}
              />
            </div>
            {esPorDefecto && (
              <p className="nota">
                Este grupo no se puede renombrar ni borrar: es donde caen los
                eventos de los grupos que se borran. El color sí se cambia.
              </p>
            )}
            {reclamarNombre && (
              <div className="msg-error" id={`${id}-falta-nombre`} role="alert">
                El nombre es obligatorio
              </div>
            )}
          </div>

          <div className="fila-campo">
            <label id={`${id}-color`}>COLOR</label>
            <div className="paleta" role="group" aria-labelledby={`${id}-color`}>
              {PALETA.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === color ? "muestra elegida" : "muestra"}
                  aria-pressed={c === color}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  data-globo aria-label={c}
                />
              ))}
              <SelectorColor color={color} onCambiar={setColor} />
            </div>
          </div>

          <div className="fila-campo">
            <label>VISTA PREVIA</label>
            {/* Es una muestra del color, no eventos de verdad: el lector de
                pantalla la salta. */}
            <div className="previa" aria-hidden="true">
              <div className="ev">
                <span className="marca" style={{ background: color }} />
                <span className="hora">08:30</span>
                <span className="titulo-ev">{nombre.trim() || "Urgente"}</span>
              </div>
              <div className="ev">
                <span className="marca" style={{ borderColor: color }} />
                <span className="hora">11:00</span>
                <span className="titulo-ev">
                  {nombre.trim() || "Importante"}
                </span>
              </div>
            </div>
          </div>

          {error && (
            <div className="msg-error" role="alert">
              {error}
            </div>
          )}
        </div>

        <div className={grupo && !esPorDefecto ? "modal-pie entre" : "modal-pie"}>
          {grupo && !esPorDefecto && (
            <button
              type="button"
              className="btn malo" data-destructivo
              onClick={() => setConfirmando(true)}
            >
              Borrar
            </button>
          )}
          <div className="par-botones">
            <button type="button" className="btn" onClick={intentarCerrar}>
              Cancelar
            </button>
            <button
              type="button"
              className={sePuedeGuardar ? "btn pri" : "btn inactivo"}
              disabled={!sePuedeGuardar}
              onClick={guardar}
            >
              {grupo ? "Guardar" : "Crear grupo"}
            </button>
          </div>
        </div>
      </div>

      {pregunta.valor && (
        <div className={pregunta.saliendo ? "velo interno saliendo" : "velo interno"}>
          <div
            className="modal angosto"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${id}-descartar`}
          >
            <div className="modal-cab">
              <h2 id={`${id}-descartar`}>¿Descartar los cambios?</h2>
            </div>
            <div className="modal-cuerpo">
              <p className="parrafo">
                Escribiste cosas que todavía no se guardan. Si cierras ahora se
                pierden.
              </p>
            </div>
            <div className="modal-pie">
              <button
                type="button"
                className="btn"
                onClick={() => setPreguntando(false)}
              >
                Seguir editando
              </button>
              <button type="button" className="btn malo" data-destructivo onClick={onCerrar}>
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmacion.valor && grupo && (
        <div className={confirmacion.saliendo ? "velo interno saliendo" : "velo interno"}>
          <div
            className="modal angosto"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={`${id}-borrar`}
          >
            <div className="modal-cab">
              <h2 id={`${id}-borrar`}>¿Borrar {grupo.nombre}?</h2>
            </div>
            <div className="modal-cuerpo">
              <p className="parrafo">
                Sus eventos no se borran: pasan al grupo Otro y toman su color.
              </p>
            </div>
            <div className="modal-pie">
              <button
                type="button"
                className="btn"
                onClick={() => setConfirmando(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn malo" data-destructivo
                disabled={guardando}
                onClick={borrar}
              >
                Borrar grupo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
