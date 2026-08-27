import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  agruparGrupos,
  carpetaDeDatos,
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
import { clave, fechaLarga, rejilla, type FormatoHora } from "./fecha";
import { Ficha } from "./Ficha";
import { Formulario, type Apertura } from "./Formulario";
import { FormularioGrupo } from "./FormularioGrupo";
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
  const [error, setError] = useState<string | null>(null);

  // Los filtros. Listas explícitas: vacía significa que no se muestra nada.
  const [gruposActivos, setGruposActivos] = useState<number[]>([]);
  const [importanciasActivas, setImportanciasActivas] = useState<Importancia[]>(
    TODAS_LAS_IMPORTANCIAS,
  );
  const [panelAbierto, setPanelAbierto] = useState(false);

  // Los grupos que ya se vieron alguna vez, para distinguir "recién creado" de
  // "desmarcado a propósito" cuando vuelve a llegar la lista.
  const conocidos = useRef<Set<number>>(new Set());

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

  // Un grupo nuevo nace visible. Los que ya existían conservan su casilla, así
  // que crear uno no deshace el filtro que estaba puesto.
  useEffect(() => {
    listarGrupos()
      .then((lista) => {
        setGrupos(agruparGrupos(lista));
        setGruposActivos((antes) =>
          lista
            .filter((g) => antes.includes(g.id) || !conocidos.current.has(g.id))
            .map((g) => g.id),
        );
        conocidos.current = new Set(lista.map((g) => g.id));
      })
      .catch((e: unknown) => setError(String(e)));
  }, [version]);

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
  }, [anio, mes, grupos, gruposActivos, importanciasActivas, version]);

  function ir(anioDestino: number, mesDestino: number) {
    setAnio(anioDestino);
    setMes(mesDestino);
    setDia(null);
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
    setGruposActivos(grupos.todos.map((g) => g.id));
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
              onGrupos={setGruposActivos}
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
