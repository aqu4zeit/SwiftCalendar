import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

import {
  agruparGrupos,
  carpetaDeDatos,
  contarPendientes,
  generarNotificaciones,
  instanciaDe,
  NACIERON,
  eventosEnRango,
  listarAjustes,
  listarGrupos,
  reordenarGrupos,
  TODAS_LAS_IMPORTANCIAS,
  type Densidad,
  type Grupo,
  type Grupos,
  type Importancia,
  type Instancia,
  type PorDia,
} from "./api";
import { clave, fechaDe, fechaLarga, rejilla, type FormatoHora } from "./fecha";
import { Ficha } from "./Ficha";
import { Formulario, type Apertura } from "./Formulario";
import { FormularioGrupo } from "./FormularioGrupo";
import { PanelAvisos } from "./PanelAvisos";
import { usePresencia } from "./presencia";
import { hayFiltroApagado, PanelFiltros } from "./PanelFiltros";
import { SelectorMes } from "./SelectorMes";
import { VistaDia } from "./VistaDia";
import { VistaMes } from "./VistaMes";

/** Hoy se calcula una vez al montar y no se refresca. */
const HOY = new Date();

export default function App() {
  const [anio, setAnio] = useState(HOY.getFullYear());
  const [mes, setMes] = useState(HOY.getMonth() + 1);
  const [porDia, setPorDia] = useState<PorDia>({});
  const [grupos, setGrupos] = useState<Grupos | null>(null);
  const [densidad, setDensidad] = useState<Densidad>("comoda");
  const [formatoHora, setFormatoHora] = useState<FormatoHora>("24");
  const [carpeta, setCarpeta] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [avisosAbiertos, setAvisosAbiertos] = useState(false);

  // Sube cada vez que algo cambia en las notificaciones, para que el panel
  // vuelva a pedir la lista sin que haya que pasarle los datos ya cargados.
  const [versionAvisos, setVersionAvisos] = useState(0);
  const avisos = usePresencia(avisosAbiertos ? true : null);
  const [error, setError] = useState<string | null>(null);

  // Los filtros. Listas explícitas: vacía significa que no se muestra nada.
  const [importanciasActivas, setImportanciasActivas] = useState<Importancia[]>(
    TODAS_LAS_IMPORTANCIAS,
  );
  const [panelAbierto, setPanelAbierto] = useState(false);

  /*
   * Los grupos escondidos a mano.
   *
   * Se guarda lo apagado y no lo encendido: así un grupo que la lista todavía no
   * había traído nace visible sin que haya que preguntarle a nadie si es nuevo.
   *
   * La forma anterior comparaba contra un conjunto de "ya conocidos" que se
   * escribía al instante mientras el estado de los filtros se aplicaba después.
   * Con los efectos corriendo dos veces —que es lo que hace React en desarrollo—
   * la segunda pasada veía todos los grupos como conocidos y ninguno como
   * marcado, y apagaba el calendario entero.
   */
  const [ocultos, setOcultos] = useState<number[]>([]);

  // Las ventanas flotantes se apilan en este orden: el día sobre el mes, y la
  // ficha o el formulario sobre el día. Cerrar la de arriba deja la de abajo.
  const [dia, setDia] = useState<Date | null>(null);
  const [abierto, setAbierto] = useState<Instancia | null>(null);
  const [formulario, setFormulario] = useState<Apertura | null>(null);

  // El formulario de grupo. `editando` ausente significa crear, y `alCrear`
  // existe cuando se abrió desde el formulario de evento, que espera el id.
  const [grupoAbierto, setGrupoAbierto] = useState<{
    editando?: Grupo;
    alCrear?: (id: number) => void;
  } | null>(null);

  // Sube cada vez que algo cambia en la base, para volver a pedir el mes.
  const [version, setVersion] = useState(0);

  // Los ajustes y la carpeta se piden una vez: ninguno cambia mientras corre.
  useEffect(() => {
    listarAjustes()
      .then((ajustes) => {
        if (ajustes.densidad === "compacta") setDensidad("compacta");
        if (ajustes.formato_hora === "12") setFormatoHora("12");
      })
      .catch((e: unknown) => setError(String(e)));

    carpetaDeDatos()
      .then(setCarpeta)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  /*
   * Las notificaciones que faltaban se generan al abrir, no solo mientras la app
   * corre: si estuvo apagada tres días, esta pasada crea los tres. Después manda
   * el temporizador nativo, que avisa cuando nace alguna.
   */
  useEffect(() => {
    let vigente = true;

    const refrescar = () =>
      contarPendientes()
        .then((n) => {
          if (!vigente) return;
          setPendientes(n);
          setVersionAvisos((v) => v + 1);
        })
        .catch((e: unknown) => vigente && setError(String(e)));

    generarNotificaciones()
      .then(refrescar)
      .catch((e: unknown) => vigente && setError(String(e)));

    const quitar = listen(NACIERON, () => void refrescar());

    return () => {
      vigente = false;
      void quitar.then((f) => f());
    };
  }, []);

  // F11 pone y quita la pantalla completa.
  //
  // La ventana lleva la barra de Windows, así que maximizar ya se puede desde
  // ella. Lo que no existe es la pantalla completa: el atajo es de la
  // aplicación, no del sistema, y hay que atenderlo a mano.
  useEffect(() => {
    async function tecla(e: KeyboardEvent) {
      if (e.key !== "F11") return;
      e.preventDefault();

      const ventana = getCurrentWindow();
      await ventana.setFullscreen(!(await ventana.isFullscreen()));
    }

    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, []);

  useEffect(() => {
    listarGrupos()
      .then((lista) => setGrupos(agruparGrupos(lista)))
      .catch((e: unknown) => setError(String(e)));
  }, [version]);

  // Los visibles salen de la lista completa menos los apagados. Un grupo que
  // acaba de nacer no está en `ocultos`, así que aparece marcado sin más.
  const gruposActivos = grupos
    ? grupos.todos.filter((g) => !ocultos.includes(g.id)).map((g) => g.id)
    : [];

  useEffect(() => {
    if (!grupos) return;

    // El rango pedido son los 42 días que se dibujan, no el mes calendario.
    const dias = rejilla(anio, mes);
    const desde = clave(dias[0]);
    const hasta = clave(dias[dias.length - 1]);

    let vigente = true;

    eventosEnRango(desde, hasta, {
      grupos: gruposActivos,
      importancias: importanciasActivas,
    })
      .then((resultado) => {
        if (!vigente) return;
        setPorDia(resultado);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!vigente) return;
        setPorDia({});
        setError(String(e));
      });

    // Descarta respuestas de un mes que ya no se está mirando.
    return () => {
      vigente = false;
    };
    // `gruposActivos` se deriva de los dos que sí son estado.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anio, mes, grupos, ocultos, importanciasActivas, version]);

  function ir(anioDestino: number, mesDestino: number) {
    setAnio(anioDestino);
    setMes(mesDestino);
    setDia(null);
  }

  /**
   * Abrir la ficha de la ocurrencia que originó una notificación.
   *
   * El mes de fondo se mueve al de la ocurrencia: cerrar la ficha tiene que dejar
   * al usuario mirando el día del que vino, no el mes donde estaba antes.
   */
  function abrirDesdeAviso(evento_id: number, ocurrencia: string) {
    const fecha = fechaDe(ocurrencia);
    setAnio(fecha.getFullYear());
    setMes(fecha.getMonth() + 1);

    instanciaDe(evento_id, ocurrencia)
      .then(setAbierto)
      .catch((e: unknown) => setError(String(e)));
  }

  /**
   * Después de escribir en la base: volver a pedir el mes.
   *
   * La vista día se queda abierta si lo estaba. Se entró a un día para trabajar
   * en él, y cerrarla por haber guardado obliga a volver a entrar.
   */
  function reordenar(ids: number[]) {
    reordenarGrupos(ids)
      .then(() => setVersion((v) => v + 1))
      .catch((e: unknown) => setError(String(e)));
  }

  function mostrarTodos() {
    if (!grupos) return;
    setOcultos([]);
    setImportanciasActivas(TODAS_LAS_IMPORTANCIAS);
  }

  /**
   * Cuál de las ventanas flotantes está arriba de todas.
   *
   * El orden se declara acá, en un solo lugar. Escape y los clics fuera actúan
   * sobre esta y nada más: si cada ventana decidiera por su cuenta, una tecla
   * cerraría varias a la vez.
   */
  const arriba = grupoAbierto
    ? "grupo"
    : formulario
      ? "formulario"
      : abierto
        ? "ficha"
        : dia
          ? "dia"
          : null;

  // Cada ventana sobrevive a su cierre el tiempo que dura su animación.
  const diaVisible = usePresencia(dia);
  const fichaVisible = usePresencia(abierto);
  const formularioVisible = usePresencia(formulario);
  const grupoVisible = usePresencia(grupoAbierto);
  const filtrosVisible = usePresencia(panelAbierto ? true : null);

  const filtrado = grupos
    ? hayFiltroApagado(grupos, gruposActivos, importanciasActivas)
    : false;

  function recargar() {
    setFormulario(null);
    setAbierto(null);
    setVersion((v) => v + 1);
  }

  return (
    <div className="app" data-densidad={densidad}>
      <div className="barra">
        <div className="titulo">
          <SelectorMes anio={anio} mes={mes} onElegir={ir} />

          {/* El botón dice qué día es hoy y lleva a hoy. Son la misma cosa: un
              botón rotulado "Hoy" al lado de la fecha de hoy repetía el mismo
              dato dos veces, y uno de los dos no hacía nada. */}
          <button
            className="boton-hoy"
            onClick={() => ir(HOY.getFullYear(), HOY.getMonth() + 1)}
          >
            {fechaLarga(HOY)}
          </button>
        </div>

        <div className="acciones">
          <button
            className={panelAbierto ? "icono on" : "icono"}
            onClick={() => setPanelAbierto(!panelAbierto)}
            title="Filtros"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h16M7 12h10M10 19h4" />
            </svg>
            {filtrado && <span className="punto" />}
          </button>

          <div className="con-panel">
            <button
              className={avisosAbiertos ? "icono on" : "icono"}
              onClick={() => setAvisosAbiertos(!avisosAbiertos)}
              title={
                pendientes === 0
                  ? "Notificaciones"
                  : `${pendientes} ${pendientes === 1 ? "pendiente" : "pendientes"}`
              }
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 01-3.4 0" />
              </svg>
              {pendientes > 0 && <span className="punto" />}
            </button>

            {avisos.valor && grupos && (
              <PanelAvisos
                grupos={grupos}
                formatoHora={formatoHora}
                version={versionAvisos}
                saliendo={avisos.saliendo}
                onCambio={() =>
                  void contarPendientes()
                    .then((n) => {
                      setPendientes(n);
                      setVersionAvisos((v) => v + 1);
                    })
                    .catch((e: unknown) => setError(String(e)))
                }
                onAbrirEvento={(evento_id, ocurrencia) => {
                  setAvisosAbiertos(false);
                  abrirDesdeAviso(evento_id, ocurrencia);
                }}
                onError={setError}
                onCerrar={() => setAvisosAbiertos(false)}
              />
            )}
          </div>

          <button
            className="nuevo-evento"
            onClick={() => setFormulario({ modo: "crear", fecha: clave(HOY) })}
            disabled={!grupos}
          >
            Nuevo evento <span>+</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="error">{error}</div>
      ) : (
        <div className="cuerpo">
          <VistaMes
            anio={anio}
            mes={mes}
            hoy={HOY}
            porDia={porDia}
            formatoHora={formatoHora}
            onNavegar={ir}
            onAbrir={setAbierto}
            onAbrirDia={setDia}
            filtrado={filtrado}
            onMostrarTodos={mostrarTodos}
          />

          {filtrosVisible.valor && grupos && (
            <PanelFiltros
              grupos={grupos}
              saliendo={filtrosVisible.saliendo}
              gruposActivos={gruposActivos}
              importanciasActivas={importanciasActivas}
              onGrupos={(activos) =>
                setOcultos(
                  grupos.todos
                    .filter((g) => !activos.includes(g.id))
                    .map((g) => g.id),
                )
              }
              onImportancias={setImportanciasActivas}
              onEditarGrupo={(g) => setGrupoAbierto({ editando: g })}
              onNuevoGrupo={() => setGrupoAbierto({})}
              onReordenar={reordenar}
            />
          )}
        </div>
      )}

      {diaVisible.valor && carpeta && (
        <VistaDia
          fecha={diaVisible.valor}
          eventos={porDia[clave(diaVisible.valor)] ?? []}
          formatoHora={formatoHora}
          carpeta={carpeta}
          activo={arriba === "dia"}
          saliendo={diaVisible.saliendo}
          onCerrar={() => setDia(null)}
          onAbrir={setAbierto}
          onCrear={() =>
            setFormulario({
              modo: "crear",
              fecha: clave(diaVisible.valor as Date),
            })
          }
        />
      )}

      {fichaVisible.valor && grupos && carpeta && (
        <Ficha
          instancia={fichaVisible.valor}
          grupos={grupos}
          carpeta={carpeta}
          formatoHora={formatoHora}
          activo={arriba === "ficha"}
          saliendo={fichaVisible.saliendo}
          onCerrar={() => setAbierto(null)}
          onEditar={(edicion) => {
            setAbierto(null);
            setFormulario({ modo: "editar", edicion });
          }}
          onBorrado={recargar}
        />
      )}

      {formularioVisible.valor && grupos && carpeta && (
        <Formulario
          grupos={grupos}
          apertura={formularioVisible.valor}
          carpeta={carpeta}
          activo={arriba === "formulario"}
          saliendo={formularioVisible.saliendo}
          onCerrar={() => setFormulario(null)}
          onGuardado={recargar}
          onNuevoGrupo={(alCrear) => setGrupoAbierto({ alCrear })}
        />
      )}

      {grupoVisible.valor && (
        <FormularioGrupo
          grupo={grupoVisible.valor.editando}
          saliendo={grupoVisible.saliendo}
          onCerrar={() => setGrupoAbierto(null)}
          onGuardado={(id) => {
            grupoVisible.valor?.alCrear?.(id);
            setGrupoAbierto(null);
            setVersion((v) => v + 1);
          }}
          onBorrado={() => {
            setGrupoAbierto(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
