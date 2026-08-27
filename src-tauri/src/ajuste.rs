//! Lectura y escritura de los ajustes guardados.

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

/// El valor de una clave.
pub fn leer(conexion: &Connection, clave: &str) -> Result<String, Error> {
    conexion
        .query_row("SELECT valor FROM ajuste WHERE clave = ?1", [clave], |f| {
            f.get(0)
        })
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Error::NoExiste,
            otro => Error::Sqlite(otro),
        })
}

/// Escribe una clave que ya existe.
///
/// Actualiza en vez de insertar: cada clave nace en una migración, así que una
/// que no está es un error del programa y no un ajuste nuevo. Sin esto, una
/// clave mal escrita se guardaría en silencio y nadie la leería nunca.
pub fn guardar(conexion: &Connection, clave: &str, valor: &str) -> Result<(), Error> {
    let filas = conexion.execute(
        "UPDATE ajuste SET valor = ?2 WHERE clave = ?1",
        [clave, valor],
    )?;

    if filas == 0 {
        return Err(Error::NoExiste);
    }

    Ok(())
}

/// Una clave de sí o no, guardada como '1' o '0'.
///
/// Cualquier otro texto es la base contradiciendo al esquema, y se dice en voz
/// alta en vez de elegir un lado.
pub fn encendido(conexion: &Connection, clave: &str) -> Result<bool, Error> {
    match leer(conexion, clave)?.as_str() {
        "1" => Ok(true),
        "0" => Ok(false),
        otro => Err(Error::DatoCorrupto(format!(
            "el ajuste '{clave}' vale '{otro}' y solo admite '0' o '1'"
        ))),
    }
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

    /// La bandeja nace encendida y su aviso todavía sin mostrar.
    #[test]
    fn la_semilla_deja_los_ajustes_de_bandeja() {
        let c = db::en_memoria();

        assert!(encendido(&c, "bandeja").unwrap());
        assert!(!encendido(&c, "arranque").unwrap());
        assert!(!encendido(&c, "aviso_bandeja_visto").unwrap());
    }

    #[test]
    fn guardar_cambia_el_valor() {
        let c = db::en_memoria();

        guardar(&c, "bandeja", "0").unwrap();
        assert!(!encendido(&c, "bandeja").unwrap());
    }

    /// Una clave que ninguna migración creó no se guarda en silencio.
    #[test]
    fn guardar_una_clave_que_no_existe_falla() {
        let c = db::en_memoria();

        assert!(matches!(
            guardar(&c, "bandejita", "1"),
            Err(Error::NoExiste)
        ));
    }

    /// Un valor fuera de '0' y '1' se denuncia en vez de interpretarse.
    #[test]
    fn un_booleano_corrupto_falla() {
        let c = db::en_memoria();
        guardar(&c, "bandeja", "quizas").unwrap();

        assert!(matches!(
            encendido(&c, "bandeja"),
            Err(Error::DatoCorrupto(_))
        ));
    }
}
