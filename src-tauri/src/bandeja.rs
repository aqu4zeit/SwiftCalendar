//! El ícono de la bandeja del sistema y el ciclo de vida de la ventana.
//!
//! La ventana se destruye al esconderla y se vuelve a construir al mostrarla.
//! Mientras no está, el proceso nativo sigue vivo con su temporizador, y todo lo
//! que el usuario ve al volver se lee de SQLite.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, Wry};

use crate::ajuste;
use crate::db::Base;
use crate::notificacion;

/// El identificador del ícono.
///
/// El ícono está puesto mientras la aplicación corre, siempre. Antes aparecía y
/// desaparecía con el ajuste, y apagar una preferencia sobre *cerrar la ventana*
/// borraba algo de la barra de tareas en el acto, sin haber cerrado nada.
///
/// Lo que el ajuste decide ahora es solo qué pasa al cerrar, y eso se pregunta a
/// la base cuando hace falta: `esconde_al_cerrar`.
pub const ID: &str = "bandeja";

/// La etiqueta de la ventana principal, la misma de `tauri.conf.json`.
const VENTANA: &str = "main";

/// El aviso que la interfaz escucha cuando el usuario cierra la ventana.
///
/// El lado nativo no esconde la ventana por su cuenta: pregunta. La interfaz es
/// la que sabe si todavía hay que explicar que la aplicación sigue viva.
pub const PIDEN_ESCONDER: &str = "bandeja://esconder";

fn icono(hay_pendientes: bool) -> tauri::Result<Image<'static>> {
    let bytes: &[u8] = if hay_pendientes {
        include_bytes!("../icons/bandeja-pendiente.png")
    } else {
        include_bytes!("../icons/bandeja.png")
    };

    Image::from_bytes(bytes)
}

fn globo(pendientes: i64) -> String {
    match pendientes {
        0 => "SwiftCalendar".to_string(),
        1 => "SwiftCalendar — 1 recordatorio pendiente".to_string(),
        n => format!("SwiftCalendar — {n} recordatorios pendientes"),
    }
}

/// El menú del ícono. Dos entradas, y no cambia nunca.
///
/// Lo dibuja Windows y no acepta estilo: es la única pantalla del proyecto que
/// no respeta el diseño. Se intentó reemplazarlo por una ventana nuestra y no
/// salió; está pospuesto hasta después de la etapa 16, con lo aprendido anotado
/// en el plan. Mientras tanto se queda en lo mínimo que Windows no puede afear:
/// dos líneas, sin la cuenta de recordatorios, que ya dicen el globo del ícono y
/// el círculo rojo.
fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let abrir = MenuItem::with_id(app, "abrir", "Abrir calendario", true, None::<&str>)?;

    // Salir va detrás de una línea, lejos de Abrir, para no apretarlo por error.
    let raya = PredefinedMenuItem::separator(app)?;
    let salir = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;

    Menu::with_items(app, &[&abrir, &raya, &salir])
}

/// Pone el ícono al día, o lo crea si todavía no está.
///
/// Una sola función responde por él entero —qué dibujo lleva y qué dice su
/// globo—, así que ningún camino puede dejarlo a medias. Los datos llegan por
/// parámetro: acá no se consulta la base.
pub fn poner_al_dia(app: &AppHandle, pendientes: i64) -> tauri::Result<()> {
    let dibujo = icono(pendientes > 0)?;

    // El menú no depende de la cuenta, así que se arma una sola vez al crear el
    // ícono. De un refresco a otro solo cambian el dibujo y el globo.
    if let Some(existente) = app.tray_by_id(ID) {
        existente.set_icon(Some(dibujo))?;
        existente.set_tooltip(Some(globo(pendientes)))?;
        return Ok(());
    }

    let lista = menu(app)?;

    TrayIconBuilder::with_id(ID)
        .icon(dibujo)
        .tooltip(globo(pendientes))
        .menu(&lista)
        // Con el menú en el clic izquierdo no queda gesto para abrir la ventana,
        // que es lo que se hace mil veces más seguido.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id().as_ref() {
            "abrir" => {
                let _ = mostrar(app);
            }
            "salir" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|icono, evento| {
            // Al soltar y no al apretar: actuar al apretar dispara con el botón
            // todavía abajo.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = evento
            {
                let _ = mostrar(icono.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Lee la base y deja la bandeja igual a lo que encuentra.
///
/// Es el único camino por el que la bandeja cambia: al arrancar, cada vez que el
/// temporizador genera avisos, y cada vez que la interfaz toca algo que mueve la
/// cuenta o el ajuste. Todos preguntan lo mismo, así que ninguno puede quedarse
/// con una versión distinta.
pub fn sincronizar(app: &AppHandle) -> Result<(), String> {
    let base = app.state::<Base>();

    let pendientes = {
        let conexion = base.0.lock().expect("la conexión quedó envenenada");
        notificacion::pendientes(&conexion).map_err(|e| e.to_string())?
    };

    poner_al_dia(app, pendientes).map_err(|e| e.to_string())
}

/// Si cerrar la ventana tiene que dejar la aplicación viva en la bandeja.
///
/// Se pregunta a la base y no a una copia en memoria: el ajuste ya vive ahí, y
/// una segunda verdad que alguien tenga que mantener al día es justo lo que este
/// proyecto evita en todas partes.
///
/// Si la base no se deja leer, la respuesta es que sí. No es una alternativa
/// silenciosa: es que equivocarse hacia "sigue viva" deja al usuario con una
/// aplicación de más, y equivocarse hacia el otro lado la cierra sin que lo haya
/// pedido.
pub fn esconde_al_cerrar(app: &AppHandle) -> bool {
    let base = app.state::<Base>();
    let conexion = base.0.lock().expect("la conexión quedó envenenada");

    match ajuste::encendido(&conexion, "bandeja") {
        Ok(valor) => valor,
        Err(e) => {
            eprintln!("no se pudo leer el ajuste de la bandeja: {e}");
            true
        }
    }
}

/// Destruye la ventana y deja solo el proceso nativo.
///
/// Destruir y no esconder: una ventana escondida conserva su webview, que en este
/// equipo son seis procesos medidos. Nada de lo que el usuario ve vive solo acá,
/// así que no hay estado que perder.
pub fn esconder(app: &AppHandle) -> tauri::Result<()> {
    match app.get_webview_window(VENTANA) {
        Some(ventana) => ventana.destroy(),
        None => Ok(()),
    }
}

/// Vuelve a construir la ventana, o trae al frente la que ya está.
///
/// Se construye desde la misma configuración que usa el arranque, para que la
/// ventana reconstruida no pueda diferir de la original.
pub fn mostrar(app: &AppHandle) -> tauri::Result<()> {
    if let Some(ventana) = app.get_webview_window(VENTANA) {
        // Minimizada, mostrar no basta: hay que devolverla a su tamaño.
        ventana.unminimize()?;
        ventana.show()?;
        ventana.set_focus()?;
        return Ok(());
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|v| v.label == VENTANA)
        .cloned()
        .expect("tauri.conf.json no declara la ventana principal");

    WebviewWindowBuilder::from_config(app, &config)?.build()?;
    Ok(())
}

/// Le pide a la interfaz que decida qué hacer con el cierre de la ventana.
///
/// El lado nativo no esconde por su cuenta porque la primera vez hay que explicar
/// antes, y quien sabe si ya se explicó es la interfaz, que tiene los ajustes
/// cargados.
pub fn pedir_esconder(app: &AppHandle) {
    let _ = app.emit(PIDEN_ESCONDER, ());
}
