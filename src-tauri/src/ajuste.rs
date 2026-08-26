//! Lectura de los ajustes guardados.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::modelo::Error;

pub fn todos(conexion: &Connection) -> Result<HashMap<String, String>, Error> {
    let mut consulta = conexion.prepare("SELECT clave, valor FROM ajuste")?;
    let filas = consulta.query_map([], |fila| {
        Ok((
            fila.get::<_, String>("clave")?,
            fila.get::<_, String>("valor")?,
        ))
    })?;

    Ok(filas.collect::<rusqlite::Result<HashMap<_, _>>>()?)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db;

    /// La semilla deja los ajustes que la interfaz necesita al arrancar.
    #[test]
    fn la_semilla_deja_los_ajustes_de_apariencia() {
        let c = db::en_memoria();
        let ajustes = todos(&c).unwrap();

        assert_eq!(ajustes.get("tema").map(String::as_str), Some("oscuro"));
        assert_eq!(ajustes.get("densidad").map(String::as_str), Some("comoda"));
    }
}
