import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

import {
  agruparGrupos,
  borrarEvento,
  carpetaDeDatos,
  contarPendientes,
  deshacer,
  esconderEnBandeja,
  generarNotificaciones,
  leerCalev,
  leerEvento,
  guardarAjuste,
  instanciaDe,
  NACIERON,
  eventosEnRango,
  listarAjustes,
  listarGrupos,
  PIDEN_ESCONDER,
  refrescarBandeja,
  rehacer,
  reordenarGrupos,
  TODAS_LAS_IMPORTANCIAS,
  type Densidad,
  type Grupo,
  type Grupos,
  type Importancia,
  type EventoDetalle,
  type Instancia,
  type Tema,
  type PorDia,
} from "./api";
import {
  clave,
  claveMes,
  fechaDe,
  fechaLarga,
  rejilla,
  type FormatoHora,
} from "./fecha";
import { Ajustes } from "./Ajustes";
import { Buscador } from "./Buscador";
import { Control } from "./Control";
import { AvisoBandeja } from "./AvisoBandeja";
import {
  edicionSegun,
  exportarAArchivo,
  ocurrenciaSegun,
  PreguntaAlcance,
  type Alcance,
} from "./acciones";
import { Ficha } from "./Ficha";
import { Globo } from "./Globo";
import { MenuContextual, type Entrada } from "./MenuContextual";

/** Sobre qué se hizo el clic derecho: un evento, o un día sin nada. */
type SobreQue = { instancia: Instancia } | { fecha: Date };
import { Paleta, type Comando } from "./Paleta";
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
  const [tema, setTema] = useState<Tema>("oscuro");
  const [densidad, setDensidad] = useState<Densidad>("comoda");
  const [formatoHora, setFormatoHora] = useState<FormatoHora>("24");
  const [carpeta, setCarpeta] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState(0);
  const [avisosAbiertos, setAvisosAbiertos] = useState(false);

  /*
   * Los dos ajustes de la bandeja.
   *
   * Parten en el valor que no interrumpe: si la respuesta de la base todavía no
   * llegó cuando el usuario cierra la ventana, no aparece un aviso a destiempo.
   */
  const [bandeja, setBandeja] = useState(true);
  const [arranque, setArranque] = useState(false);
  const [avisoVisto, setAvisoVisto] = useState(true);
  const [ajustesAbiertos, setAjustesAbiertos] = useState(false);
  const [controlAbierto, setControlAbierto] = useState(false);
  const [buscadorAbierto, setBuscadorAbierto] = useState(false);
  const [paletaAbierta, setPaletaAbierta] = useState(false);

  /*
   * El menú del clic derecho, y lo que quedó pendiente de él.
   *
   * `pedido` sobrevive al menú: elegir "Editar" lo cierra, pero todavía hay que
   * leer el evento para saber si se repite, y solo entonces se sabe si hay que
   * preguntar el alcance.
   */
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    sobre: SobreQue;
  } | null>(null);

  const [pedido, setPedido] = useState<{
    accion: "editar" | "borrar";
    instancia: Instancia;
    detalle: EventoDetalle;
  } | null>(null);
  const [alcance, setAlcance] = useState<Alcance>("solo_esta");
  const [ocupado, setOcupado] = useState(false);
  const [avisandoBandeja, setAvisandoBandeja] = useState(false);

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

  /*
   * Si el filtro guardado ya llegó.
   *
   * Sin esto, el primer render guardaría el filtro vacío del estado inicial
   * encima del que está en la base, y abrir la aplicación borraría lo elegido.
   */
  const [filtroCargado, setFiltroCargado] = useState(false);

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

  // La carpeta no cambia nunca; los ajustes solo desde su propio panel, que
  // escribe en la base y refresca esto mismo.
  useEffect(() => {
    listarAjustes()
      .then((ajustes) => {
        if (ajustes.tema === "claro") setTema("claro");
        if (ajustes.densidad === "compacta") setDensidad("compacta");
        if (ajustes.formato_hora === "12") setFormatoHora("12");
        setBandeja(ajustes.bandeja === "1");
        setArranque(ajustes.arranque === "1");
        setAvisoVisto(ajustes.aviso_bandeja_visto === "1");

        // Lo apagado, no lo visible: un grupo creado después de guardar nace
        // visible sin que nadie tenga que preguntarse si es nuevo.
        setOcultos(
          (ajustes.filtro_grupos_ocultos ?? "")
            .split(",")
            .filter((t) => t !== "")
            .map(Number),
        );

        const guardadas = (ajustes.filtro_importancias ?? "")
          .split(",")
          .filter((t): t is Importancia =>
            TODAS_LAS_IMPORTANCIAS.includes(t as Importancia),
          );
        setImportanciasActivas(guardadas);

        setFiltroCargado(true);
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
    generarNotificaciones()
      .then(refrescarAvisos)
      .catch((e: unknown) => setError(String(e)));

    const quitar = listen(NACIERON, () => void refrescarAvisos());

    return () => void quitar.then((f) => f());
    // `refrescarAvisos` solo escribe estado; no depende de nada que cambie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * Cerrar la ventana no la cierra: el lado nativo pregunta antes.
   *
   * La primera vez hay que explicar qué pasó, y quién sabe si ya se explicó es
   * esta parte, que tiene los ajustes cargados.
   */
  useEffect(() => {
    const quitar = listen(PIDEN_ESCONDER, () => {
      if (avisoVisto) void esconderEnBandeja().catch(() => {});
      else setAvisandoBandeja(true);
    });

    return () => void quitar.then((f) => f());
  }, [avisoVisto]);

  /*
   * El tema se marca en la raíz del documento y no en `.app`.
   *
   * El fondo lo pinta `body`, que está fuera del árbol de React, y los velos y
   * el globo se dibujan con posición fija. Marcando la raíz, la paleta entera
   * cambia sin que ninguna regla del CSS tenga que saber en qué tema está.
   */
  useEffect(() => {
    document.documentElement.dataset.tema = tema;
  }, [tema]);


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

  /**
   * Volver a contar los pendientes y dejar al día lo que los muestra.
   *
   * La campana y el ícono de la bandeja dibujan el mismo número, así que se
   * ponen al día juntos: por caminos separados uno de los dos quedaría contando
   * lo de antes cada vez que se agregue un lugar donde la cuenta cambia.
   */
  function refrescarAvisos() {
    return contarPendientes()
      .then((n) => {
        setPendientes(n);
        setVersionAvisos((v) => v + 1);
        return refrescarBandeja();
      })
      .catch((e: unknown) => setError(String(e)));
  }

  /** Escribe un ajuste y lo refleja acá. El lado nativo ya lo dejó aplicado. */
  function guardar(clave: string, valor: string) {
    guardarAjuste(clave, valor)
      .then(() => {
        if (clave === "bandeja") setBandeja(valor === "1");
        if (clave === "arranque") setArranque(valor === "1");
        if (clave === "aviso_bandeja_visto") setAvisoVisto(valor === "1");
        if (clave === "tema") setTema(valor as Tema);
        if (clave === "densidad") setDensidad(valor as Densidad);
        if (clave === "formato_hora") setFormatoHora(valor as FormatoHora);
      })
      .catch((e: unknown) => setError(String(e)));
  }

  /**
   * Dar por visto el aviso —si se pidió— y esconder la ventana.
   *
   * Lo uno antes de lo otro, y no las dos a la vez: destruir la ventana se lleva
   * lo que todavía no haya cruzado al lado nativo, y el ajuste perdido haría
   * reaparecer el aviso la próxima vez.
   */
  function esconder(noRepetir: boolean) {
    setAvisandoBandeja(false);

    const guardado = noRepetir
      ? guardarAjuste("aviso_bandeja_visto", "1").then(() => setAvisoVisto(true))
      : Promise.resolve();

    void guardado
      .catch((e: unknown) => setError(String(e)))
      .finally(() => void esconderEnBandeja().catch(() => {}));
  }

  /**
   * Elegir un archivo `.calev` y abrir el formulario con sus datos.
   *
   * No se crea nada acá: importar termina en el mismo formulario de siempre, y
   * el evento nace cuando el usuario guarda. Así lo importado se puede revisar y
   * corregir antes de entrar a la base.
   */
  function importar() {
    void open({
      multiple: false,
      filters: [{ name: "Evento de SwiftCalendar", extensions: ["calev"] }],
    })
      .then((ruta) => {
        if (typeof ruta !== "string") return;
        return leerCalev(ruta).then((importado) =>
          setFormulario({ modo: "importar", importado }),
        );
      })
      .catch((e: unknown) => setError(String(e)));
  }

  /*
   * El filtro se guarda al cambiar, no al cerrar.
   *
   * Al esconder la aplicación en la bandeja la ventana se destruye, así que no
   * hay un momento de cierre en el que alcance a guardar nada. Escribir dos
   * claves cuando el usuario toca una casilla no se nota.
   */
  useEffect(() => {
    if (!filtroCargado) return;

    guardarAjuste("filtro_grupos_ocultos", ocultos.join(","))
      .then(() =>
        guardarAjuste("filtro_importancias", importanciasActivas.join(",")),
      )
      .catch((e: unknown) => setError(String(e)));
  }, [filtroCargado, ocultos, importanciasActivas]);

  /**
   * Qué ofrece el menú, según sobre qué se hizo clic derecho.
   *
   * Se arma acá y no dentro del menú por la misma razón que los comandos de la
   * paleta: esa pantalla sabe dibujar y colocarse, no qué se puede hacer.
   */
  function entradasPara(sobre: SobreQue): Entrada[] {
    return "instancia" in sobre
      ? [
          { id: "editar", texto: "Editar evento" },
          { id: "exportar", texto: "Exportar evento" },
          { id: "borrar", texto: "Borrar evento", malo: true },
        ]
      : [{ id: "nuevo-aqui", texto: "Nuevo evento aquí", signo: "+" }];
  }

  /**
   * Lo que se eligió en el menú.
   *
   * Editar y borrar leen el evento antes de nada: la instancia que tiene la
   * celda no lleva la regla de repetición —decisión 73—, así que hasta acá no se
   * sabe si hay que preguntar el alcance.
   */
  async function elegirDelMenu(id: string) {
    const sobre = menu?.sobre;
    setMenu(null);
    if (!sobre) return;

    if ("fecha" in sobre) {
      if (id === "nuevo-aqui") setFormulario({ modo: "crear", fecha: clave(sobre.fecha) });
      return;
    }

    const instancia = sobre.instancia;
    try {
      const detalle = await leerEvento(instancia.evento_id);

      if (id === "exportar") return void (await exportarAArchivo(detalle));

      // Editar un evento suelto no tiene nada que preguntar; borrarlo sí, porque
      // la confirmación es la única red que tiene.
      const esSerie = detalle.rrule != null;
      if (id === "editar" && !esSerie) {
        return setFormulario({
          modo: "editar",
          edicion: edicionSegun(detalle, instancia, false, "todas"),
        });
      }

      setAlcance("solo_esta");
      setPedido({ accion: id === "borrar" ? "borrar" : "editar", instancia, detalle });
    } catch (e: unknown) {
      setError(String(e));
    }
  }

  /** Seguir adelante con lo que el menú dejó pendiente, ya elegido el alcance. */
  async function seguirPedido() {
    if (!pedido) return;
    const { accion, instancia, detalle } = pedido;
    const esSerie = detalle.rrule != null;

    if (accion === "editar") {
      setPedido(null);
      setFormulario({
        modo: "editar",
        edicion: edicionSegun(detalle, instancia, esSerie, alcance),
      });
      return;
    }

    setOcupado(true);
    try {
      await borrarEvento(
        instancia.evento_id,
        ocurrenciaSegun(instancia, esSerie, alcance),
      );
      setPedido(null);
      setVersion((v) => v + 1);
      void refrescarAvisos();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setOcupado(false);
    }
  }

  function ir(anioDestino: number, mesDestino: number) {
    setAnio(anioDestino);
    setMes(mesDestino);
    setDia(null);
  }

  /**
   * Abrir la ficha de una ocurrencia concreta.
   *
   * La piden los avisos y el buscador: los dos saben de qué evento y de qué
   * ocurrencia hablan, y ninguno tiene el tramo ya resuelto. El mes de fondo se
   * mueve al de la ocurrencia, porque cerrar la ficha tiene que dejar al usuario
   * mirando el día del que vino y no el mes donde estaba antes.
   */
  function abrirOcurrencia(evento_id: number, ocurrencia: string) {
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
  const arriba = avisandoBandeja
    ? "aviso"
    : pedido
      ? "alcance"
      : paletaAbierta
      ? "paleta"
      : buscadorAbierto
      ? "buscador"
      : controlAbierto
      ? "control"
      : ajustesAbiertos
      ? "ajustes"
      : grupoAbierto
        ? "grupo"
        : formulario
          ? "formulario"
          : abierto
            ? "ficha"
            : dia
              ? "dia"
              : null;

  /**
   * Lo que se puede hacer con el calendario, con su nombre ya resuelto.
   *
   * La paleta no sabe cómo está cada cosa: recibe "Cerrar filtros" o "Abrir
   * filtros" ya decidido. Es la misma lista que alimenta a los atajos, así que
   * un comando nuevo aparece en los dos lados sin escribirlo dos veces.
   */
  const comandos: Comando[] = [
    { id: "nuevo", nombre: "Nuevo evento", atajo: "Ctrl+N" },
    { id: "importar", nombre: "Importar evento desde un archivo" },
    { id: "hoy", nombre: "Ir a hoy" },
    { id: "mes-anterior", nombre: "Mes anterior", atajo: "←" },
    { id: "mes-siguiente", nombre: "Mes siguiente", atajo: "→" },
    {
      id: "filtros",
      nombre: panelAbierto ? "Cerrar los filtros" : "Abrir los filtros",
    },
    { id: "mostrar-todos", nombre: "Quitar todos los filtros" },
    {
      id: "avisos",
      nombre: avisosAbiertos
        ? "Cerrar los recordatorios"
        : "Ver los recordatorios",
    },
    { id: "buscar", nombre: "Buscar un evento", atajo: "Ctrl+F" },
    { id: "ajustes", nombre: "Abrir los ajustes", atajo: "Ctrl+," },
    {
      id: "tema",
      nombre: tema === "oscuro" ? "Usar el tema claro" : "Usar el tema oscuro",
    },
    { id: "deshacer", nombre: "Deshacer", atajo: "Ctrl+Z" },
    { id: "rehacer", nombre: "Rehacer", atajo: "Ctrl+Shift+Z" },
    { id: "pantalla-completa", nombre: "Pantalla completa", atajo: "F11" },
  ];

  async function ejecutar(id: string) {
    setPaletaAbierta(false);

    switch (id) {
      case "nuevo":
        return setFormulario({ modo: "crear", fecha: clave(HOY) });
      case "importar":
        return importar();
      case "hoy":
        return ir(HOY.getFullYear(), HOY.getMonth() + 1);
      case "mes-anterior":
        return ir(mes === 1 ? anio - 1 : anio, mes === 1 ? 12 : mes - 1);
      case "mes-siguiente":
        return ir(mes === 12 ? anio + 1 : anio, mes === 12 ? 1 : mes + 1);
      case "filtros":
        return setPanelAbierto(!panelAbierto);
      case "mostrar-todos":
        return mostrarTodos();
      case "avisos":
        return setAvisosAbiertos(!avisosAbiertos);
      case "buscar":
        return setBuscadorAbierto(true);
      case "ajustes":
        return setAjustesAbiertos(true);
      case "tema":
        return guardar("tema", tema === "oscuro" ? "claro" : "oscuro");
      case "pantalla-completa": {
        const ventana = getCurrentWindow();
        return void ventana.setFullscreen(!(await ventana.isFullscreen()));
      }
      case "deshacer":
      case "rehacer": {
        try {
          const hubo = id === "rehacer" ? await rehacer() : await deshacer();
          if (hubo) {
            setVersion((v) => v + 1);
            void refrescarAvisos();
          }
        } catch (e: unknown) {
          setError(String(e));
        }
        return;
      }
    }
  }

  /**
   * Los atajos de teclado de la aplicación, en un solo lugar.
   *
   * Casi todos actúan solo con el calendario al frente: con una ventana flotante
   * abierta, lo que el usuario está mirando no es lo que cambiaría. Es la misma
   * regla que gobierna a `Esc`, y por eso mira la misma variable.
   *
   * `Ctrl+K` y `F11` son la excepción: la paleta se abre encima de todo y se
   * cierra sola, y la pantalla completa no toca ningún dato.
   */
  useEffect(() => {
    function escribiendo() {
      const foco = document.activeElement;
      return (
        foco instanceof HTMLInputElement || foco instanceof HTMLTextAreaElement
      );
    }

    function tecla(e: KeyboardEvent) {
      if (e.key === "F11") {
        e.preventDefault();
        void ejecutar("pantalla-completa");
        return;
      }

      // La paleta se abre desde donde sea, salvo escribiendo: ahí Ctrl+K no
      // tiene otro uso, pero abrir una ventana encima de un texto a medias sí
      // sorprende.
      if (e.ctrlKey && e.key.toLowerCase() === "k" && !escribiendo()) {
        e.preventDefault();
        setPaletaAbierta(true);
        return;
      }

      // El buscador, por la misma razón y con la misma excepción: Ctrl+F no
      // tiene otro uso, salvo dentro de un campo de texto.
      if (e.ctrlKey && e.key.toLowerCase() === "f" && !escribiendo()) {
        e.preventDefault();
        setBuscadorAbierto(true);
        return;
      }

      if (arriba !== null || escribiendo()) return;

      if (e.ctrlKey) {
        const clave = e.key.toLowerCase();

        // Dentro de un campo de texto ya se descartó arriba: acá Ctrl+Z es el
        // de la aplicación y no el del navegador.
        if (clave === "z" || clave === "y") {
          e.preventDefault();
          return void ejecutar(clave === "y" || e.shiftKey ? "rehacer" : "deshacer");
        }
        if (clave === "n") {
          e.preventDefault();
          return void ejecutar("nuevo");
        }
        if (e.key === ",") {
          e.preventDefault();
          return void ejecutar("ajustes");
        }
        return;
      }

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        return void ejecutar("mes-anterior");
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        return void ejecutar("mes-siguiente");
      }
    }

    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  });

  // Cada ventana sobrevive a su cierre el tiempo que dura su animación.
  const diaVisible = usePresencia(dia);
  const fichaVisible = usePresencia(abierto);
  const formularioVisible = usePresencia(formulario);
  const grupoVisible = usePresencia(grupoAbierto);
  const filtrosVisible = usePresencia(panelAbierto ? true : null);
  const paletaVisible = usePresencia(paletaAbierta ? true : null);
  const menuVisible = usePresencia(menu);
  const ajustesVisible = usePresencia(ajustesAbiertos ? true : null);
  const controlVisible = usePresencia(controlAbierto ? true : null);
  const buscadorVisible = usePresencia(buscadorAbierto ? true : null);
  const avisoVisible = usePresencia(avisandoBandeja ? true : null);

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
            data-texto="Filtros"
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
              data-texto={
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
                onCambio={() => void refrescarAvisos()}
                onAbrirEvento={(evento_id, ocurrencia) => {
                  setAvisosAbiertos(false);
                  abrirOcurrencia(evento_id, ocurrencia);
                }}
                onError={setError}
                onCerrar={() => setAvisosAbiertos(false)}
              />
            )}
          </div>

          <button
            className="icono"
            onClick={importar}
            data-texto="Importar evento"
            disabled={!grupos}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v12M8 11l4 4 4-4M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4" />
            </svg>
          </button>

          <button
            className={ajustesAbiertos ? "icono on" : "icono"}
            onClick={() => setAjustesAbiertos(!ajustesAbiertos)}
            data-texto="Ajustes"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
            </svg>
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
            onMenu={(x, y, sobre) => setMenu({ x, y, sobre })}
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
          onMenu={(x, y, instancia) =>
            setMenu({ x, y, sobre: { instancia } })
          }
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
          aviso={
            formularioVisible.valor.modo === "importar" &&
            formularioVisible.valor.importado.duplicado
              ? "Este evento ya lo importaste antes. Si lo guardas quedará repetido."
              : undefined
          }
          activo={arriba === "formulario"}
          saliendo={formularioVisible.saliendo}
          onCerrar={() => setFormulario(null)}
          onGuardado={recargar}
          onNuevoGrupo={(alCrear) => setGrupoAbierto({ alCrear })}
        />
      )}

      {ajustesVisible.valor && carpeta && (
        <Ajustes
          tema={tema}
          densidad={densidad}
          formatoHora={formatoHora}
          carpeta={carpeta}
          bandeja={bandeja}
          avisar={!avisoVisto}
          arranque={arranque}
          activo={arriba === "ajustes"}
          saliendo={ajustesVisible.saliendo}
          onGuardar={guardar}
          onAbrirControl={() => setControlAbierto(true)}
          onCerrar={() => setAjustesAbiertos(false)}
        />
      )}

      {controlVisible.valor && (
        <Control
          formatoHora={formatoHora}
          activo={arriba === "control"}
          saliendo={controlVisible.saliendo}
          onCambio={() => {
            recargar();
            void refrescarAvisos();
          }}
          onCerrar={() => setControlAbierto(false)}
        />
      )}

      {buscadorVisible.valor && (
        <Buscador
          mes={claveMes(anio, mes)}
          formatoHora={formatoHora}
          activo={arriba === "buscador"}
          saliendo={buscadorVisible.saliendo}
          onIr={(evento) => {
            setBuscadorAbierto(false);
            abrirOcurrencia(evento.evento_id, evento.ocurrencia);
          }}
          onError={setError}
          onCerrar={() => setBuscadorAbierto(false)}
        />
      )}

      {avisoVisible.valor && (
        <AvisoBandeja
          activo={arriba === "aviso"}
          saliendo={avisoVisible.saliendo}
          onEntendido={esconder}
          onAbrirAjustes={(noRepetir) => {
            setAvisandoBandeja(false);
            if (noRepetir) guardar("aviso_bandeja_visto", "1");
            setAjustesAbiertos(true);
          }}
        />
      )}

      {menuVisible.valor && (
        <MenuContextual
          entradas={entradasPara(menuVisible.valor.sobre)}
          x={menuVisible.valor.x}
          y={menuVisible.valor.y}
          saliendo={menuVisible.saliendo}
          onElegir={(id) => void elegirDelMenu(id)}
          onCerrar={() => setMenu(null)}
        />
      )}

      {pedido && (
        <PreguntaAlcance
          accion={pedido.accion}
          detalle={pedido.detalle}
          instancia={pedido.instancia}
          esSerie={pedido.detalle.rrule != null}
          alcance={alcance}
          ocupado={ocupado}
          onAlcance={setAlcance}
          onCancelar={() => setPedido(null)}
          onSeguir={() => void seguirPedido()}
        />
      )}

      {paletaVisible.valor && (
        <Paleta
          comandos={comandos}
          activo={arriba === "paleta"}
          saliendo={paletaVisible.saliendo}
          onElegir={(id) => void ejecutar(id)}
          onCerrar={() => setPaletaAbierta(false)}
        />
      )}

      {/* Uno solo para toda la aplicación, encima de todo lo demás. */}
      <Globo />

      {grupoVisible.valor && (
        <FormularioGrupo
          grupo={grupoVisible.valor.editando}
          activo={arriba === "grupo"}
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
