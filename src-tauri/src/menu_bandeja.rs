//! El menú del ícono de la bandeja, dibujado por nosotros.
//!
//! Es una ventana sin decoración, transparente y anclada sobre el ícono, con el
//! mismo CSS que el menú del clic derecho del calendario. Existe porque el menú
//! nativo lo dibuja Windows entero y no acepta más estilo que el modo claro u
//! oscuro, que es lo que hace `tema_nativo` (decisión 102).
//!
//! **No se destruye al cerrarse: se esconde y se duerme.** Crearlo cuesta
//! levantar un webview entero, y hacerlo en cada clic derecho pondría un menú
//! que tarda más que el parpadeo. Dormido abre al instante.
//!
//! **Las entradas son datos, no código.** Esta parte arma la lista y la interfaz
//! solo la dibuja, igual que el menú del clic derecho recibe las suyas ya
//! resueltas (decisión 113). Es lo que deja la puerta abierta a que un
//! complemento agregue las suyas: una entrada más en la lista y un caso más en
//! `elegir`, sin tocar el dibujo ni las medidas de la ventana.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::bandeja;
use crate::db::Base;
use crate::notificacion;
use crate::sueno;

/// La etiqueta de la ventana del menú.
const VENTANA: &str = "menu-bandeja";

/// El ancho del menú, en puntos.
const ANCHO: f64 = 216.0;

/// El alto de una entrada y el del separador, iguales a los del CSS.
const ENTRADA: f64 = 31.0;
const SEPARADOR: f64 = 9.0;
/// Los 5 px de relleno de `.menu-contextual`, arriba y abajo, más los bordes.
const RELLENO: f64 = 12.0;

/// Lo que separa el menú del borde del ícono.
const AIRE: f64 = 8.0;

/// El aviso que el menú escucha para volver a armarse.
pub const REARMAR: &str = "bandeja://rearmar";

/// Una entrada del menú.
///
/// Viaja entera a la interfaz: lo que dice, cómo se dibuja y qué devuelve al
/// elegirla. La interfaz no decide nada de esto, igual que el menú del clic
/// derecho no sabe qué se puede hacer con un evento.
#[derive(Debug, Clone, Serialize)]
pub struct Entrada {
    /// Estable. Es lo que vuelve por `elegir_del_menu`.
    pub id: String,
    pub texto: String,
    /// Un punto de color delante, para lo que pide que lo miren.
    pub marca: bool,
    /// Lo que no se puede deshacer se dibuja aparte.
    pub malo: bool,
    /// Una línea encima, para separarla de lo anterior.
    pub separada: bool,
}

impl Entrada {
    fn nueva(id: &str, texto: impl Into<String>) -> Self {
        Entrada {
            id: id.to_string(),
            texto: texto.into(),
            marca: false,
            malo: false,
            separada: false,
        }
    }

    fn marcada(mut self) -> Self {
        self.marca = true;
        self
    }

    fn mala(mut self) -> Self {
        self.malo = true;
        self
    }

    fn separada(mut self) -> Self {
        self.separada = true;
        self
    }
}

/// Lo que el menú ofrece ahora mismo.
///
/// Se arma cada vez que el menú se abre y no se guarda: entre un clic y el
/// siguiente el temporizador puede haber creado recordatorios.
///
/// Cuando existan los complementos, es acá donde se pegan los suyos.
pub fn entradas(app: &AppHandle) -> Vec<Entrada> {
    let pendientes = pendientes(app);

    let mut lista = vec![
        Entrada::nueva("abrir", "Abrir calendario"),
        Entrada::nueva("ajustes", "Ajustes"),
    ];

    // La cuenta solo aparece cuando hay algo que contar. Una entrada que dice
    // "0 recordatorios" ocupa sitio para no decir nada, y el ícono ya lo dice
    // callándose: sin círculo rojo no hay nada pendiente.
    if pendientes > 0 {
        let texto = if pendientes == 1 {
            "1 recordatorio".to_string()
        } else {
            format!("{pendientes} recordatorios")
        };
        lista.push(Entrada::nueva("avisos", texto).marcada().separada());
    }

    // Salir va detrás de una línea, lejos de Abrir, para no apretarlo por error.
    lista.push(Entrada::nueva("salir", "Salir").mala().separada());
    lista
}

/// Cuántos recordatorios hay pendientes.
fn pendientes(app: &AppHandle) -> i64 {
    let base = app.state::<Base>();
    let conexion = base.0.lock().expect("la conexión quedó envenenada");

    notificacion::pendientes(&conexion).unwrap_or(0)
}

/// El alto que necesita una lista de entradas.
fn alto(lista: &[Entrada]) -> f64 {
    let filas = lista.len() as f64 * ENTRADA;
    let rayas = lista.iter().filter(|e| e.separada).count() as f64 * SEPARADOR;

    filas + rayas + RELLENO
}

/// Dónde va la esquina superior izquierda del menú.
///
/// Pegado al ícono y hacia arriba, que es donde cabe: la bandeja vive en la
/// esquina de la barra de tareas y un menú que creciera hacia abajo quedaría
/// fuera de la pantalla. Se alinea por el borde derecho del ícono.
fn sitio(rect: Rect, alto: f64, escala: f64) -> (f64, f64) {
    // El rectángulo del ícono puede venir en píxeles o en puntos; la ventana se
    // coloca en puntos. La conversión la hace el propio tipo, que es quien sabe
    // en cuál de los dos está.
    let icono = rect.position.to_logical::<f64>(escala);
    let tamano = rect.size.to_logical::<f64>(escala);

    (icono.x + tamano.width - ANCHO, icono.y - alto - AIRE)
}

/// Dónde está el ícono en la barra de tareas.
///
/// Lo dice cada evento del ícono. Se guarda porque el cierre por pérdida de foco
/// necesita saber si el clic que se lo quitó cayó encima del ícono: si cayó ahí,
/// cerrar sería un error, porque el clic que viene después va a cerrarlo él.
#[derive(Default)]
pub struct SitioDelIcono(pub Mutex<Option<Rect>>);

/// Anota dónde está el ícono. Lo llama el manejador de eventos de la bandeja.
pub fn anotar_sitio(app: &AppHandle, rect: Rect) {
    let sitio = app.state::<SitioDelIcono>();
    *sitio.0.lock().expect("el sitio del ícono quedó envenenado") = Some(rect);
}

/// Deja la ventana del tamaño que pide su contenido y pegada al ícono.
fn colocar<R: Runtime>(ventana: &WebviewWindow<R>, rect: Rect, alto: f64) -> tauri::Result<()> {
    let escala = ventana.scale_factor()?;
    let (x, y) = sitio(rect, alto, escala);

    ventana.set_size(LogicalSize::new(ANCHO, alto))?;
    ventana.set_position(LogicalPosition::new(x, y))
}

/// Abre el menú, o lo cierra si ya estaba.
///
/// El mismo clic hace las dos cosas, como cualquier menú: apretar el ícono con
/// el menú abierto lo cierra en vez de dibujar otro.
pub fn alternar(app: &AppHandle, rect: Rect) -> tauri::Result<()> {
    let alto = alto(&entradas(app));

    match app.get_webview_window(VENTANA) {
        Some(ventana) if ventana.is_visible()? => dormir(&ventana),
        Some(ventana) => despertar(&ventana, rect, alto),
        None => crear(app, rect, alto),
    }
}

/// Lo esconde y lo deja dormido hasta el próximo clic.
fn dormir<R: Runtime>(ventana: &WebviewWindow<R>) -> tauri::Result<()> {
    ventana.hide()?;
    sueno::suspender(ventana)
}

/// Lo coloca donde toca, lo despierta y lo muestra.
fn despertar<R: Runtime>(ventana: &WebviewWindow<R>, rect: Rect, alto: f64) -> tauri::Result<()> {
    colocar(ventana, rect, alto)?;

    // El dibujo es el de la vez anterior, y la lista pudo cambiar mientras
    // dormía: hay que pedirle que se vuelva a armar.
    ventana.emit_to(VENTANA, REARMAR, ())?;

    sueno::reanudar(ventana)?;
    ventana.show()?;
    ventana.set_focus()
}

/// Lo crea por primera y única vez.
fn crear(app: &AppHandle, rect: Rect, alto: f64) -> tauri::Result<()> {
    let escala = app
        .primary_monitor()?
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let (x, y) = sitio(rect, alto, escala);

    let ventana = WebviewWindowBuilder::new(
        app,
        VENTANA,
        WebviewUrl::App("index.html?ventana=bandeja".into()),
    )
    // Sin marco ni barra: el borde y las esquinas los dibuja el CSS, igual que
    // en el menú del clic derecho.
    .decorations(false)
    .transparent(true)
    // La sombra la pone el CSS también. La del sistema sería un rectángulo
    // alrededor de una caja con esquinas redondeadas.
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .inner_size(ANCHO, alto)
    .position(x, y)
    .build()?;

    let mano = app.clone();
    ventana.on_window_event(move |evento| {
        if let WindowEvent::Focused(false) = evento {
            cerrar_si_toca(&mano);
        }
    });

    Ok(())
}

/// Cierra el menú al perder el foco, salvo que el cursor esté sobre el ícono.
///
/// Sin esa excepción, apretar el ícono con el menú abierto lo cierra y lo vuelve
/// a abrir: el botón al bajar le quita el foco —y esto lo cerraría— y el botón al
/// subir lo abre otra vez. Es el mismo problema que tauri#8869, y la salida no es
/// un temporizador sino mirar dónde cayó el clic.
fn cerrar_si_toca(app: &AppHandle) {
    if sobre_el_icono(app) {
        return;
    }

    if let Some(ventana) = app.get_webview_window(VENTANA) {
        let _ = dormir(&ventana);
    }
}

/// Si el cursor está dentro del rectángulo del ícono.
fn sobre_el_icono(app: &AppHandle) -> bool {
    let sitio = app.state::<SitioDelIcono>();
    let guardado = *sitio.0.lock().expect("el sitio del ícono quedó envenenado");

    let (Some(rect), Ok(cursor)) = (guardado, app.cursor_position()) else {
        return false;
    };

    // El cursor viene en píxeles, así que el rectángulo se lleva a píxeles. La
    // escala no interviene: los dos extremos quedan en la misma unidad.
    let icono = rect.position.to_physical::<f64>(1.0);
    let tamano = rect.size.to_physical::<f64>(1.0);

    cursor.x >= icono.x
        && cursor.x <= icono.x + tamano.width
        && cursor.y >= icono.y
        && cursor.y <= icono.y + tamano.height
}

/// Lo que el menú tiene que dibujar. Lo pide al abrirse y cada vez que despierta.
#[tauri::command]
pub fn entradas_del_menu(app: AppHandle) -> Vec<Entrada> {
    entradas(&app)
}

/// El aviso que la ventana principal escucha para abrir uno de sus paneles.
pub const PIDEN_PANEL: &str = "bandeja://panel";

/// Ejecuta lo que se eligió en el menú.
///
/// Todas las entradas pasan por acá, incluida la que agregue un complemento el
/// día que existan: la interfaz devuelve un identificador y no sabe qué hace.
#[tauri::command]
pub fn elegir_del_menu(app: AppHandle, id: String) -> Result<(), String> {
    // Lo primero es apartarlo: lo que sigue abre ventanas, y el menú no tiene
    // por qué seguir encima mientras tanto.
    if let Some(ventana) = app.get_webview_window(VENTANA) {
        let _ = dormir(&ventana);
    }

    match id.as_str() {
        // Apartarlo era todo lo que había que hacer.
        "cerrar" => Ok(()),
        "salir" => {
            app.exit(0);
            Ok(())
        }
        "abrir" => bandeja::mostrar(&app).map_err(|e| e.to_string()),
        "ajustes" | "avisos" => {
            bandeja::mostrar(&app).map_err(|e| e.to_string())?;
            app.emit(PIDEN_PANEL, id).map_err(|e| e.to_string())
        }
        otro => Err(format!("el menú de la bandeja no sabe qué es '{otro}'")),
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use tauri::{PhysicalPosition, PhysicalSize};

    /// El rectángulo que reporta un ícono de bandeja de 24 px.
    fn icono(x: f64, y: f64) -> Rect {
        Rect {
            position: PhysicalPosition::new(x, y).into(),
            size: PhysicalSize::new(24u32, 24u32).into(),
        }
    }

    /// Un menú de las entradas que sean, con una raya antes de la última.
    fn lista(cuantas: usize) -> Vec<Entrada> {
        (0..cuantas)
            .map(|i| {
                let entrada = Entrada::nueva(&format!("e{i}"), "Entrada");
                if i + 1 == cuantas {
                    entrada.separada()
                } else {
                    entrada
                }
            })
            .collect()
    }

    #[test]
    fn el_alto_cuenta_las_filas_y_las_rayas() {
        assert_eq!(alto(&lista(2)), 2.0 * ENTRADA + SEPARADOR + RELLENO);
        assert_eq!(alto(&lista(3)), alto(&lista(2)) + ENTRADA);
    }

    /// Una entrada más la agranda sola: es lo que permite que un complemento
    /// agregue la suya sin tocar ninguna medida.
    #[test]
    fn una_entrada_mas_agranda_la_ventana() {
        let con_complemento = alto(&lista(4));

        assert_eq!(con_complemento - alto(&lista(3)), ENTRADA);
    }

    /// El menú queda encima del ícono y alineado por su borde derecho.
    #[test]
    fn se_ancla_sobre_el_icono() {
        let alto = alto(&lista(3));
        let (x, y) = sitio(icono(1872.0, 1040.0), alto, 1.0);

        assert_eq!(x + ANCHO, 1872.0 + 24.0, "el borde derecho coincide");
        assert_eq!(y + alto + AIRE, 1040.0, "queda encima, con su aire");
    }

    /// Con la pantalla al 150 %, el ícono viene en píxeles y la ventana se
    /// coloca en puntos: la conversión tiene que estar hecha.
    #[test]
    fn el_anclaje_respeta_la_escala() {
        let alto = alto(&lista(3));
        let (x, y) = sitio(icono(2808.0, 1560.0), alto, 1.5);

        assert_eq!(x + ANCHO, 2808.0 / 1.5 + 24.0 / 1.5);
        assert_eq!(y + alto + AIRE, 1560.0 / 1.5);
    }

    /// Siempre hacia arriba: la bandeja está en la esquina de abajo y un menú
    /// que creciera hacia el otro lado quedaría fuera de la pantalla.
    #[test]
    fn siempre_crece_hacia_arriba() {
        let arriba = sitio(icono(1872.0, 1040.0), alto(&lista(4)), 1.0).1;

        assert!(arriba < 1040.0);
    }
}
