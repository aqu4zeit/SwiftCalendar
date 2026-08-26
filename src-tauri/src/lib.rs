mod ajuste;
mod archivo;
mod comandos;
mod db;
mod evento;
mod grupo;
mod historial;
mod hora;
mod modelo;
mod ocurrencia;
mod rango;
mod recurrencia;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // La base se abre una sola vez y queda como estado de la aplicación.
            let base = db::abrir(app.handle());
            app.manage(base);

            // La carpeta de datos es fija: se resuelve una vez y se guarda.
            app.manage(archivo::Carpeta(db::carpeta_de_datos(app.handle())));

            // El historial vive del lado nativo para sobrevivir al minimizar.
            app.manage(historial::Pila(Default::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            comandos::eventos_en_rango,
            comandos::listar_grupos,
            comandos::crear_grupo,
            comandos::editar_grupo,
            comandos::borrar_grupo,
            comandos::reordenar_grupos,
            comandos::listar_ajustes,
            comandos::carpeta_de_datos,
            comandos::vista_previa_imagen,
            comandos::leer_evento,
            comandos::crear_evento,
            comandos::editar_evento,
            comandos::borrar_evento
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
