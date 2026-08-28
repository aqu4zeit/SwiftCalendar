mod ajuste;
mod archivo;
mod bandeja;
mod catalogo;
mod comandos;
mod compartir;
mod db;
mod evento;
mod grupo;
mod historial;
mod hora;
mod menu_bandeja;
mod modelo;
mod notificacion;
mod ocurrencia;
mod rango;
mod recurrencia;
mod respaldo;
mod sueno;
mod tema_nativo;

use std::time::Duration;

use chrono::Timelike;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

/// Lo que falta para el próximo cambio de minuto.
///
/// Dormir sesenta segundos fijos deja el hilo desfasado respecto al reloj: si la
/// aplicación abrió a las 10:37:38, todas las pasadas caen en el segundo 38 y un
/// aviso de las 10:38:00 espera treinta y ocho segundos de más. Durmiendo hasta
/// el borde del minuto, el aviso aparece apenas llega su hora.
///
/// Se calcula contra el reloj en cada vuelta y no se acumula: si el equipo se
/// suspende, al despertar el cálculo vuelve a partir de la hora real.
fn hasta_el_proximo_minuto() -> Duration {
    let ahora = chrono::Local::now();

    let transcurridos =
        u64::from(ahora.second()) * 1000 + u64::from(ahora.nanosecond()) / 1_000_000;

    // El mínimo evita un giro en vacío si el cálculo cae justo en el borde.
    Duration::from_millis((60_000 - transcurridos.min(59_950)).max(50))
}

/// El aviso que la interfaz escucha para refrescar la campana.
const NACIERON: &str = "notificaciones://nuevas";

/// Con qué se reconoce el arranque que hizo Windows y no el usuario.
///
/// En ese caso la ventana no se crea: la aplicación se queda en la bandeja, que
/// es lo único que se pidió al activar el arranque automático.
const ARRANQUE_AUTOMATICO: &str = "--arranque-automatico";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // El argumento es lo que Windows le pasa a la aplicación al iniciarla
        // sola, y es lo que distingue ese arranque de uno pedido por el usuario.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![ARRANQUE_AUTOMATICO]),
        ))
        .setup(|app| {
            // La base se abre una sola vez y queda como estado de la aplicación.
            let base = db::abrir(app.handle());
            app.manage(base);

            // La carpeta de datos es fija: se resuelve una vez y se guarda.
            app.manage(archivo::Carpeta(db::carpeta_de_datos(app.handle())));

            // El historial vive del lado nativo para sobrevivir al minimizar.
            app.manage(historial::Pila(Default::default()));
            app.manage(menu_bandeja::SitioDelIcono::default());

            // Lo que dibuja Windows —el menú del ícono y los diálogos del
            // sistema— sigue el tema de la aplicación, no el del equipo.
            tema_nativo::aplicar(bandeja::tema_oscuro(app.handle()));

            // La limpieza corre acá y no después: es el único momento en que el
            // historial está vacío, así que ningún archivo hace falta todavía
            // para deshacer un borrado. Decisión 93.
            limpiar_huerfanos(app.handle());

            bandeja::sincronizar(app.handle()).expect("no se pudo montar la bandeja");

            // La ventana la crea el código y no la configuración, porque a veces
            // no hay que crearla. `bandeja::mostrar` ya sabe armarla desde la
            // misma configuración de siempre, así que no hay dos definiciones.
            if !std::env::args().any(|a| a == ARRANQUE_AUTOMATICO) {
                bandeja::mostrar(app.handle()).expect("no se pudo crear la ventana");
            }

            arrancar_temporizador(app.handle().clone());
            Ok(())
        })
        .on_window_event(|ventana, evento| {
            let app = ventana.app_handle();

            // La condición vive en cada caso que la necesita, y no en un `return`
            // a la entrada. Gobernando la puerta, cualquier evento que se
            // agregara después dejaría de atenderse con el ajuste apagado, y
            // nadie sabría por qué.
            match evento {
                // Cerrar no cierra, si el ajuste dice que la aplicación sigue
                // viva. Quién decide qué mostrar es la interfaz, que sabe si
                // todavía hay que explicarlo.
                WindowEvent::CloseRequested { api, .. } => {
                    if bandeja::esconde_al_cerrar(app) {
                        api.prevent_close();
                        bandeja::pedir_esconder(app);
                    } else {
                        // Cerrar el calendario con la bandeja apagada termina la
                        // aplicación, y se dice acá en vez de dejarlo en manos de
                        // "quedarse sin ventanas": el menú de la bandeja también
                        // es una ventana, y vive escondida.
                        app.exit(0);
                    }
                }

                // Minimizar esconde de inmediato: no hay nada que explicar,
                // porque el ícono queda a la vista en la bandeja.
                //
                // No existe un evento de minimizado; lo que llega es un cambio de
                // tamaño, y hay que preguntarle a la ventana en qué quedó.
                WindowEvent::Resized(_) => {
                    if bandeja::esconde_al_cerrar(app)
                        && ventana.is_minimized().unwrap_or(false)
                    {
                        let _ = bandeja::esconder(app);
                    }
                }

                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            comandos::eventos_en_rango,
            comandos::listar_grupos,
            comandos::crear_grupo,
            comandos::editar_grupo,
            comandos::borrar_grupo,
            comandos::reordenar_grupos,
            comandos::listar_ajustes,
            comandos::guardar_ajuste,
            comandos::carpeta_de_datos,
            comandos::vista_previa_imagen,
            comandos::leer_evento,
            comandos::crear_evento,
            comandos::editar_evento,
            comandos::borrar_evento,
            comandos::listar_eventos,
            comandos::pagina_buscador,
            menu_bandeja::menu_de_bandeja,
            menu_bandeja::elegir_del_menu,
            comandos::borrar_todos,
            comandos::generar_notificaciones,
            comandos::listar_notificaciones,
            comandos::instancia_de,
            comandos::contar_pendientes,
            comandos::marcar_vista,
            comandos::marcar_todas_vistas,
            comandos::borrar_notificacion,
            comandos::borrar_notificaciones_vistas,
            comandos::refrescar_bandeja,
            comandos::esconder_en_bandeja,
            comandos::exportar_evento,
            comandos::leer_calev,
            comandos::deshacer,
            comandos::rehacer,
            comandos::exportar_respaldo,
            comandos::restaurar_respaldo
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app, evento| {
        // Quedarse sin ventanas no es motivo para terminar si el ajuste dice que
        // la aplicación sigue viva en la bandeja: ahí corre el temporizador que
        // genera los recordatorios.
        //
        // `code` distingue las dos salidas: viene vacío cuando se cerró la última
        // ventana, y con valor cuando alguien pidió salir de verdad. Sin esa
        // diferencia, "Salir" del menú tampoco podría cerrar la aplicación.
        if let RunEvent::ExitRequested { code, api, .. } = evento {
            if code.is_none() && bandeja::esconde_al_cerrar(app) {
                api.prevent_exit();
            }
        }
    });
}

/// Borra los archivos de la carpeta que ya no nombra ninguna fila.
///
/// Las dos mitades viven separadas: `evento` sabe qué sigue en uso y `archivo`
/// sabe borrar, y ninguna de las dos sabe de la otra. Acá se juntan.
///
/// Si algo falla no se corta el arranque: quedan archivos de más, que es
/// exactamente el estado que esta función existe para mejorar.
fn limpiar_huerfanos(app: &tauri::AppHandle) {
    let base = app.state::<db::Base>();
    let carpeta = app.state::<archivo::Carpeta>();

    let referenciados = {
        let conexion = base.0.lock().expect("la conexión quedó envenenada");
        evento::rutas_referenciadas(&conexion)
    };

    match referenciados {
        Err(e) => eprintln!("no se pudo listar los archivos en uso: {e}"),
        Ok(referenciados) => {
            let borrados = archivo::borrar_huerfanos(&carpeta.0, &referenciados);
            if borrados > 0 {
                println!("SwiftCalendar — {borrados} archivos huérfanos borrados");
            }
        }
    }
}

/// El hilo que genera notificaciones mientras la aplicación vive.
///
/// Vive del lado nativo y no en la interfaz porque al minimizar a la bandeja la
/// ventana se destruye y este temporizador tiene que seguir corriendo. Que la
/// interfaz lo hiciera obligaría a escribirlo dos veces.
///
/// Si una pasada falla no se corta el hilo: la próxima vuelve a intentarlo, y lo
/// que no se generó ahora se genera entonces, porque el rango se calcula desde la
/// marca guardada y no desde la última vez que salió bien.
fn arrancar_temporizador(app: tauri::AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(hasta_el_proximo_minuto());

        let base = app.state::<db::Base>();
        let creadas = {
            let conexion = base.0.lock().expect("la conexión quedó envenenada");
            notificacion::pasada(&conexion)
        };

        match creadas {
            Ok(0) => {}
            Ok(cuantas) => {
                // La interfaz puede no estar: al minimizar, la ventana se destruye
                // y no hay a quién avisarle. Los registros ya están en la base, así
                // que se leen al restaurarla.
                let _ = app.emit(NACIERON, cuantas);

                // El ícono sí está siempre, y es lo único que el usuario ve
                // mientras la ventana no existe.
                if let Err(e) = bandeja::sincronizar(&app) {
                    eprintln!("no se pudo poner al día la bandeja: {e}");
                }
            }
            Err(e) => eprintln!("no se pudieron generar notificaciones: {e}"),
        }
    });
}
