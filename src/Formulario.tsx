import { useEffect, useState } from "react";

import {
  crearEvento,
  editarEvento,
  type Cuando,
  type AdjuntoPedido,
  type Edicion,
  type EventoNuevo,
  type ImagenPedida,
  type Grupos,
  type Importancia,
} from "./api";
import { Archivos } from "./Archivos";
import { BotonBorrar } from "./BotonBorrar";
import { CampoFecha } from "./CampoFecha";
import { Desplegable } from "./Desplegable";
import { horaValida, mascaraHora } from "./fecha";
import { MasOpciones } from "./MasOpciones";
import {
  aRrule,
  desdeRrule,
  repeticionCompleta,
  seSolapaConsigoMismo,
  SIN_REPETICION,
  type Repeticion,
} from "./rrule";

/**
 * Con qué se abre el formulario.
 *
 * Crear siempre trae su día: desde la barra superior es hoy, y desde la vista
 * día es el día que se está mirando. Sin el campo, el formulario tendría que
 * elegir uno por su cuenta y habría dos lugares decidiendo lo mismo.
 */
export type Apertura =
  | { modo: "crear"; fecha: string }
  | { modo: "editar"; edicion: Edicion };

/** Con qué imagen abre el formulario: la que ya tenía el evento, o ninguna. */
function imagenActual(edicion: Edicion | null): ImagenPedida {
  const detalle = edicion?.detalle;
  if (!detalle?.imagen || !detalle.miniatura) return { tipo: "sin" };

  return {
    tipo: "guardada",
    original: detalle.imagen,
    miniatura: detalle.miniatura,
  };
}

/** Con qué archivos abre, por la misma razón que la imagen. */
function adjuntosActuales(edicion: Edicion | null): AdjuntoPedido[] {
  return (edicion?.detalle.adjuntos ?? []).map((a) => ({
    tipo: "guardado",
    ruta: a.ruta,
    nombre_original: a.nombre_original,
    tamano: a.tamano,
  }));
}

interface Props {
  grupos: Grupos;
  apertura: Apertura;
  /** La carpeta de datos, para mostrar una imagen que ya está guardada. */
  carpeta: string;
  /** Falso si hay otra ventana encima: el teclado lo cierra a él, no a este. */
  activo: boolean;
  /** Verdadero mientras se está yendo. */
  saliendo: boolean;
  onCerrar: () => void;
  onGuardado: () => void;
  /** Crear un grupo sin salir del formulario. Devuelve el que se creó. */
  onNuevoGrupo: (alCrear: (id: number) => void) => void;
}

const IMPORTANCIAS: { valor: Importancia; texto: string }[] = [
  { valor: "comun", texto: "Común" },
  { valor: "importante", texto: "Importante" },
  { valor: "urgente", texto: "Urgente" },
];

/** Todo lo que el formulario edita, junto, para poder compararlo con su estado inicial. */
interface Campos {
  titulo: string;
  grupoId: number;
  importancia: Importancia;
  fechaInicio: string;
  horaInicio: string;
  fechaFin: string;
  horaFin: string;
  todoElDia: boolean;
  descripcion: string;
  repeticion: Repeticion;
  recordatorio: number | null;
  adaptable: boolean;
  ubicacion: string;
  url: string;
  imagen: ImagenPedida;
  adjuntos: AdjuntoPedido[];
}

/** El formulario en blanco, sobre un día concreto. */
function enBlanco(grupoId: number, fecha: string): Campos {
  return {
    titulo: "",
    grupoId,
    importancia: "comun",
    fechaInicio: fecha,
    horaInicio: "09:00",
    fechaFin: "",
    horaFin: "",
    todoElDia: false,
    descripcion: "",
    repeticion: SIN_REPETICION,
    recordatorio: null,
    adaptable: false,
    ubicacion: "",
    url: "",
    imagen: { tipo: "sin" },
    adjuntos: [],
  };
}

/**
 * El formulario cargado con un evento que ya existe.
 *
 * Las fechas no salen del detalle sino de la edición: al separar una ocurrencia
 * son las de esa ocurrencia, y al tocar toda la serie son las de la fila
 * maestra. Guardar la fecha de la ocurrencia sobre la serie completa correría la
 * serie entera y borraría las repeticiones anteriores.
 */
function desdeEdicion(edicion: Edicion): Campos {
  const { detalle, inicio, fin } = edicion;

  // Separar una ocurrencia produce un evento suelto. La regla no se hereda: el
  // campo está escondido, y un estado que la conserve manda algo que la
  // pantalla no muestra y el lado nativo rechaza.
  const repeticion =
    edicion.ocurrencia !== null || detalle.rrule === null
      ? SIN_REPETICION
      : desdeRrule(detalle.rrule);

  return {
    titulo: detalle.titulo,
    grupoId: detalle.grupo_id,
    importancia: detalle.importancia,
    fechaInicio: inicio.slice(0, 10),
    horaInicio: inicio.slice(11, 16),
    fechaFin: fin === null ? "" : fin.slice(0, 10),
    horaFin: fin === null ? "" : fin.slice(11, 16),
    todoElDia: detalle.cuando === "todo_el_dia",
    descripcion: detalle.descripcion ?? "",
    repeticion,
    recordatorio: detalle.recordatorio_min,
    adaptable: detalle.cuando === "adaptable",
    ubicacion: detalle.ubicacion ?? "",
    url: detalle.url ?? "",
    imagen: imagenActual(edicion),
    adjuntos: adjuntosActuales(edicion),
  };
}

export function Formulario({
  grupos,
  apertura,
  carpeta,
  activo,
  saliendo,
  onCerrar,
  onGuardado,
  onNuevoGrupo,
}: Props) {
  const edicion = apertura.modo === "editar" ? apertura.edicion : null;

  // Una ocurrencia separada de su serie es un evento suelto: no se repite.
  const permiteRepeticion = edicion === null || edicion.ocurrencia === null;

  const [inicial] = useState<Campos>(() =>
    apertura.modo === "editar"
      ? desdeEdicion(apertura.edicion)
      : enBlanco(grupos.porDefecto.id, apertura.fecha),
  );

  const [campos, setCampos] = useState<Campos>(inicial);
  const [masAbierto, setMasAbierto] = useState(false);
  const [preguntando, setPreguntando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  function set(parcial: Partial<Campos>) {
    setCampos((actuales) => ({ ...actuales, ...parcial }));
  }

  const hayCambios = JSON.stringify(campos) !== JSON.stringify(inicial);

  function intentarCerrar() {
    if (hayCambios) setPreguntando(true);
    else onCerrar();
  }

  useEffect(() => {
    if (!activo) return;

    function tecla(evento: KeyboardEvent) {
      if (evento.key !== "Escape") return;
      if (preguntando) setPreguntando(false);
      else intentarCerrar();
    }
    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  });

  // Validación. El botón se ve siempre; lo que cambia es si funciona.
  const faltaTitulo = campos.titulo.trim() === "";
  const inicioValido =
    campos.fechaInicio !== "" &&
    (campos.todoElDia || horaValida(campos.horaInicio) !== null);

  // Una hora de fin sin fecha se entiende en el mismo día del inicio. Si es
  // anterior a la hora de inicio, el día deja de poder deducirse y hay que
  // declararlo: adivinar el día siguiente sería inventar un evento multi-día.
  const horaFinEscrita = !campos.todoElDia && campos.horaFin !== "";
  const finImplicito = campos.fechaFin === "" && horaFinEscrita;
  const fechaFinReal = finImplicito ? campos.fechaInicio : campos.fechaFin;

  const relojInicio = horaValida(campos.horaInicio);
  const relojFin = horaValida(campos.horaFin);
  const finAlReves =
    finImplicito &&
    relojInicio !== null &&
    relojFin !== null &&
    relojFin < relojInicio;

  const finVacio = campos.fechaFin === "" && !horaFinEscrita;
  const finCompleto =
    fechaFinReal !== "" &&
    (campos.todoElDia || relojFin !== null) &&
    !finAlReves;
  const finValido = finVacio || finCompleto;

  const errorFin = finAlReves
    ? "Termina antes de empezar. Declara la fecha de fin o cambia la hora."
    : campos.fechaFin !== "" && !campos.todoElDia && campos.horaFin === ""
      ? "Falta la hora de fin"
      : null;

  const sePuedeGuardar =
    !faltaTitulo &&
    inicioValido &&
    finValido &&
    repeticionCompleta(campos.repeticion) &&
    !guardando;

  const colorDelGrupo = grupos.todos.find((g) => g.id === campos.grupoId)?.color;

  const seSolapa = seSolapaConsigoMismo(
    campos.fechaInicio,
    fechaFinReal,
    campos.horaFin,
    campos.todoElDia,
    campos.repeticion,
  );

  async function guardar() {
    const inicio = `${campos.fechaInicio} ${
      campos.todoElDia ? "00:00" : horaValida(campos.horaInicio)
    }`;
    const fin =
      fechaFinReal === ""
        ? null
        : `${fechaFinReal} ${campos.todoElDia ? "00:00" : relojFin}`;

    if (fin !== null && fin < inicio) {
      setError("El fin no puede ser anterior al inicio");
      return;
    }

    setGuardando(true);
    try {
      const cuerpo: EventoNuevo = {
        grupo_id: campos.grupoId,
        titulo: campos.titulo.trim(),
        inicio,
        fin,
        cuando: (campos.todoElDia
          ? "todo_el_dia"
          : campos.adaptable
            ? "adaptable"
            : "fija") as Cuando,
        importancia: campos.importancia,
        descripcion:
          campos.descripcion.trim() === "" ? null : campos.descripcion.trim(),
        ubicacion:
          campos.ubicacion.trim() === "" ? null : campos.ubicacion.trim(),
        url: campos.url.trim() === "" ? null : campos.url.trim(),
        imagen: campos.imagen,
        adjuntos: campos.adjuntos,
        rrule: aRrule(campos.repeticion),
        recordatorio_min: campos.recordatorio,
      };

      if (edicion) {
        await editarEvento(edicion.detalle.id, edicion.ocurrencia, cuerpo);
      } else {
        await crearEvento(cuerpo);
      }
      onGuardado();
    } catch (e: unknown) {
      setError(String(e));
      setGuardando(false);
    }
  }

  return (
    <div className={saliendo ? "velo saliendo" : "velo"}>
      <div className="modal">
        <div className="modal-cab">
          <h2>{edicion ? "Editar evento" : "Nuevo evento"}</h2>
          <button type="button" className="cerrar" onClick={intentarCerrar}>
            ✕
          </button>
        </div>

        <div className="modal-cuerpo">
          <div className="fila-campo">
            <label>TÍTULO</label>
            <input
              className={faltaTitulo ? "campo-titulo malo" : "campo-titulo"}
              type="text"
              placeholder="Título del evento"
              value={campos.titulo}
              onChange={(e) => set({ titulo: e.target.value })}
              autoFocus
            />
            {faltaTitulo && (
              <div className="msg-error">El título es obligatorio</div>
            )}
          </div>

          <div className="fila-campo">
            <label>GRUPO</label>
            <Desplegable
              valor={String(campos.grupoId)}
              opciones={grupos.todos.map((g) => ({
                valor: String(g.id),
                texto: g.nombre,
                color: g.color,
              }))}
              onElegir={(v) => set({ grupoId: Number(v) })}
              accion={{
                texto: "Crear grupo…",
                onAccion: () => onNuevoGrupo((id) => set({ grupoId: id })),
              }}
            />
          </div>

          <div className="fila-campo">
            <label>IMPORTANCIA</label>
            <div className="segmentado">
              {IMPORTANCIAS.map((opcion) => (
                <button
                  key={opcion.valor}
                  type="button"
                  className={
                    campos.importancia === opcion.valor ? "on" : undefined
                  }
                  onClick={() => set({ importancia: opcion.valor })}
                >
                  {/* Común no dibuja nada, pero la barra ocupa su ancho igual.
                      Sin ella, su etiqueta arranca en otro sitio que las otras
                      dos y las tres dejan de compartir un eje. */}
                  <span
                    className="marca"
                    style={
                      opcion.valor === "urgente"
                        ? { background: colorDelGrupo }
                        : opcion.valor === "importante"
                          ? { borderColor: colorDelGrupo }
                          : undefined
                    }
                  />
                  {opcion.texto}
                </button>
              ))}
            </div>
          </div>

          <div className="fila-campo">
            <label>INICIO</label>
            <div className="par">
              <CampoFecha
                valor={campos.fechaInicio}
                onCambiar={(fechaInicio) => set({ fechaInicio })}
              />
              {!campos.todoElDia && (
                <div
                  className={
                    horaValida(campos.horaInicio) === null
                      ? "campo hora malo"
                      : "campo hora"
                  }
                >
                  <input
                    type="text"
                    value={campos.horaInicio}
                    placeholder="HH:MM"
                    inputMode="numeric"
                    onChange={(e) =>
                      set({ horaInicio: mascaraHora(e.target.value) })
                    }
                  />
                  {campos.horaInicio !== "" && (
                    <BotonBorrar onBorrar={() => set({ horaInicio: "" })} />
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="fila-campo">
            <label>FIN</label>
            <div className="par">
              <CampoFecha
                valor={campos.fechaFin}
                onCambiar={(fechaFin) => set({ fechaFin })}
                placeholder="Sin fin declarado"
              />
              {!campos.todoElDia && (
                <div
                  className={
                    campos.horaFin !== "" &&
                    horaValida(campos.horaFin) === null
                      ? "campo hora malo"
                      : "campo hora"
                  }
                >
                  <input
                    type="text"
                    value={campos.horaFin}
                    placeholder="HH:MM"
                    inputMode="numeric"
                    onChange={(e) =>
                      set({ horaFin: mascaraHora(e.target.value) })
                    }
                  />
                  {campos.horaFin !== "" && (
                    <BotonBorrar onBorrar={() => set({ horaFin: "" })} />
                  )}
                </div>
              )}
            </div>
            {errorFin && <div className="msg-error">{errorFin}</div>}
          </div>

          <div className="fila-campo interruptor">
            <button
              type="button"
              className={campos.todoElDia ? "sw on" : "sw"}
              onClick={() => set({ todoElDia: !campos.todoElDia })}
            >
              <i />
            </button>
            <span>Todo el día</span>
          </div>

          <div className="fila-campo">
            <label>DESCRIPCIÓN</label>
            <textarea
              className="area"
              placeholder="Opcional"
              value={campos.descripcion}
              onChange={(e) => set({ descripcion: e.target.value })}
            />
          </div>

          <Archivos
            carpeta={carpeta}
            imagen={campos.imagen}
            onImagen={(imagen) => set({ imagen })}
            adjuntos={campos.adjuntos}
            onAdjuntos={(adjuntos) => set({ adjuntos })}
          />

          <MasOpciones
            abierto={masAbierto}
            onAlternar={() => setMasAbierto(!masAbierto)}
            permiteRepeticion={permiteRepeticion}
            repeticion={campos.repeticion}
            onRepeticion={(repeticion) => set({ repeticion })}
            recordatorio={campos.recordatorio}
            onRecordatorio={(recordatorio) => set({ recordatorio })}
            adaptable={campos.adaptable}
            onAdaptable={(adaptable) => set({ adaptable })}
            todoElDia={campos.todoElDia}
            ubicacion={campos.ubicacion}
            onUbicacion={(ubicacion) => set({ ubicacion })}
            url={campos.url}
            onUrl={(url) => set({ url })}
          />

          {seSolapa && (
            <div className="aviso">
              El evento dura más que su intervalo de repetición, así que una
              ocurrencia alcanza a la siguiente y vas a verlo dos veces en los
              días compartidos. Se puede crear igual.
            </div>
          )}

          {error && <div className="msg-error">{error}</div>}
        </div>

        <div className="modal-pie">
          <button type="button" className="btn" onClick={intentarCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className={sePuedeGuardar ? "btn pri" : "btn inactivo"}
            disabled={!sePuedeGuardar}
            onClick={guardar}
          >
            {edicion ? "Guardar cambios" : "Crear evento"}
          </button>
        </div>
      </div>

      {preguntando && (
        <div className="velo interno">
          <div className="modal angosto">
            <div className="modal-cab">
              <h2>
                {edicion ? "¿Descartar los cambios?" : "¿Descartar el evento?"}
              </h2>
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
              <button type="button" className="btn malo" onClick={onCerrar}>
                Descartar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
