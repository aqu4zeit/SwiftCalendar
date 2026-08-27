//! Apertura de la base de datos y control de versiones del esquema.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

/// Las migraciones en orden. La posición en esta lista es el número de versión:
const MIGRACIONES: &[&str] = &[
    include_str!("../migrations/001_esquema_inicial.sql"),
    include_str!("../migrations/002_formato_hora.sql"),
    include_str!("../migrations/003_generado_hasta.sql"),
    include_str!("../migrations/004_aviso_bandeja.sql"),
    include_str!("../migrations/005_uid_evento.sql"),
];

/// La conexión, guardada como estado de la aplicación.
pub struct Base(pub Mutex<Connection>);

/// Prepara la carpeta de datos, abre la base y deja el esquema al día.
pub fn abrir(app: &AppHandle) -> Base {
    let carpeta = carpeta_de_datos(app);

    for sub in ["assets/imagenes", "assets/miniaturas", "assets/adjuntos"] {
        fs::create_dir_all(carpeta.join(sub))
            .unwrap_or_else(|e| panic!("no se pudo crear {}: {e}", carpeta.join(sub).display()));
    }

    let archivo = carpeta.join("calendario.db");
    let mut conexion = Connection::open(&archivo)
        .unwrap_or_else(|e| panic!("no se pudo abrir {}: {e}", archivo.display()));

    // Las claves foráneas se activan por conexión, no por base.
    conexion
        .execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
        .expect("no se pudieron aplicar los pragmas de la conexión");

    migrar(&mut conexion);

    println!("SwiftCalendar — base en {}", archivo.display());
    Base(Mutex::new(conexion))
}

/// Una base en memoria con el esquema ya aplicado, para las pruebas.
#[cfg(test)]
pub fn en_memoria() -> Connection {
    let mut conexion = Connection::open_in_memory().expect("no se pudo abrir la base en memoria");
    conexion
        .execute_batch("PRAGMA foreign_keys = ON;")
        .expect("no se pudieron aplicar los pragmas");
    migrar(&mut conexion);
    conexion
}

/// `Documentos/SwiftCalendar`. Fija, no configurable.
pub fn carpeta_de_datos(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .expect("el sistema no reporta carpeta de Documentos")
        .join("SwiftCalendar")
}

/// Aplica las migraciones que falten, en orden y cada una en su transacción.
fn migrar(conexion: &mut Connection) {
    let actual: usize = conexion
        .query_row("PRAGMA user_version", [], |fila| fila.get(0))
        .map(|v: i64| v as usize)
        .expect("no se pudo leer user_version");

    // Una base más nueva que el programa no se puede tocar.
    assert!(
        actual <= MIGRACIONES.len(),
        "la base está en la versión {actual} y este programa solo conoce hasta la {}",
        MIGRACIONES.len()
    );

    for (indice, sql) in MIGRACIONES.iter().enumerate().skip(actual) {
        let version = indice + 1;
        let tx = conexion
            .transaction()
            .expect("no se pudo abrir la transacción de migración");

        tx.execute_batch(sql)
            .unwrap_or_else(|e| panic!("falló la migración {version}: {e}"));

        // `user_version` es transaccional: si la migración falla, tampoco avanza.
        tx.pragma_update(None, "user_version", version as i64)
            .expect("no se pudo escribir user_version");

        tx.commit()
            .unwrap_or_else(|e| panic!("no se pudo confirmar la migración {version}: {e}"));

        println!("SwiftCalendar — esquema migrado a la versión {version}");
    }
}
