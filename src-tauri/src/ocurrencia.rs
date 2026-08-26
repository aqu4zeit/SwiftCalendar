//! Operaciones sobre una ocurrencia suelta de una serie.
//!
//! Borrar una ocurrencia y modificarla son la misma escritura: una fila de
//! excepción. La única diferencia es si esa fila apunta a un evento o a nada.

use rusqlite::{params, Connection, OptionalExtension};

use crate::evento;
use crate::historial::Accion;
use crate::modelo::{Error, EventoCompleto, EventoNuevo};

/// Excluye una ocurrencia de su serie, con o sin evento que la reemplace.
pub fn excluir(
    conexion: &Connection,
    maestro_id: i64,
    fecha_original: &str,
    reemplazo: Option<EventoNuevo>,
) -> Result<Accion, Error> {
    let maestro = evento::leer(conexion, maestro_id)?;
    if maestro.rrule.is_none() {
        return Err(Error::NoEsUnaSerie(maestro_id));
    }

    let tx = conexion.unchecked_transaction()?;

    let override_id = match reemplazo {
        None => None,
        Some(nuevo) => Some(evento::insertar(&tx, nuevo)?),
    };

    tx.execute(
        "INSERT INTO excepcion (evento_id, fecha_original, override_id) VALUES (?1, ?2, ?3)",
        params![maestro_id, fecha_original, override_id],
    )?;

    tx.commit()?;

    Ok(Accion::OcurrenciaExcluida {
        maestro_id,
        fecha_original: fecha_original.to_string(),
    })
}

/// Devuelve una ocurrencia a su serie y se lleva el reemplazo, si lo había.
pub fn devolver(
    conexion: &Connection,
    maestro_id: i64,
    fecha_original: &str,
) -> Result<Accion, Error> {
    let tx = conexion.unchecked_transaction()?;

    let override_id: Option<i64> = tx
        .query_row(
            "SELECT override_id FROM excepcion WHERE evento_id = ?1 AND fecha_original = ?2",
            params![maestro_id, fecha_original],
            |f| f.get(0),
        )
        .optional()?
        .ok_or(Error::NoExiste)?;

    let reemplazo = match override_id {
        None => None,
        Some(id) => Some(evento::capturar(&tx, id)?),
    };

    tx.execute(
        "DELETE FROM excepcion WHERE evento_id = ?1 AND fecha_original = ?2",
        params![maestro_id, fecha_original],
    )?;

    if let Some(id) = override_id {
        tx.execute("DELETE FROM evento WHERE id = ?1", [id])?;
    }

    tx.commit()?;

    Ok(Accion::OcurrenciaDevuelta {
        maestro_id,
        fecha_original: fecha_original.to_string(),
        reemplazo,
    })
}

/// Vuelve a excluir una ocurrencia, con el reemplazo que tenía.
pub fn restaurar(
    conexion: &Connection,
    maestro_id: i64,
    fecha_original: &str,
    reemplazo: Option<&EventoCompleto>,
) -> Result<Accion, Error> {
    let tx = conexion.unchecked_transaction()?;

    if let Some(completo) = reemplazo {
        evento::insertar_completo(&tx, completo)?;
    }

    tx.execute(
        "INSERT INTO excepcion (evento_id, fecha_original, override_id) VALUES (?1, ?2, ?3)",
        params![
            maestro_id,
            fecha_original,
            reemplazo.map(|c| c.evento.id)
        ],
    )?;

    tx.commit()?;

    Ok(Accion::OcurrenciaExcluida {
        maestro_id,
        fecha_original: fecha_original.to_string(),
    })
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db;
    use crate::grupo;
    use crate::historial::Historial;
    use crate::modelo::{Cuando, Importancia};
    use crate::recurrencia;
    use chrono::{NaiveDate, NaiveDateTime};

    fn dia(a: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(a, m, d).unwrap()
    }

    fn momento(a: i32, m: u32, d: u32, h: u32) -> NaiveDateTime {
        dia(a, m, d).and_hms_opt(h, 0, 0).unwrap()
    }

    fn base(conexion: &Connection, titulo: &str, inicio: NaiveDateTime) -> EventoNuevo {
        EventoNuevo {
            grupo_id: grupo::listar(conexion).unwrap()[0].id,
            titulo: titulo.to_string(),
            inicio,
            fin: None,
            cuando: Cuando::Fija,
            importancia: Importancia::Comun,
            color: None,
            descripcion: None,
            ubicacion: None,
            url: None,
            imagen: None,
            rrule: None,
            recordatorio_min: None,
            adjuntos: Vec::new(),
        }
    }

    /// Una clase semanal que empieza el lunes 3 de agosto.
    fn serie(conexion: &Connection) -> i64 {
        let mut nuevo = base(conexion, "Clase de redes", momento(2026, 8, 3, 9));
        nuevo.rrule = Some("FREQ=WEEKLY".to_string());
        evento::insertar(conexion, nuevo).unwrap()
    }

    fn ocurrencias_de(conexion: &Connection, id: i64) -> Vec<NaiveDateTime> {
        let e = evento::leer(conexion, id).unwrap();
        recurrencia::ocurrencias(conexion, &e, dia(2026, 8, 1), dia(2026, 8, 31)).unwrap()
    }

    fn cuantas_excepciones(conexion: &Connection) -> i64 {
        conexion
            .query_row("SELECT COUNT(*) FROM excepcion", [], |f| f.get(0))
            .unwrap()
    }

    /// Borrar una sola ocurrencia deja una excepción sin reemplazo.
    #[test]
    fn borrar_solo_esta_quita_la_ocurrencia() {
        let c = db::en_memoria();
        let id = serie(&c);
        assert_eq!(ocurrencias_de(&c, id).len(), 5);

        excluir(&c, id, "2026-08-17 09:00", None).unwrap();

        let quedan = ocurrencias_de(&c, id);
        assert_eq!(quedan.len(), 4);
        assert!(!quedan.contains(&momento(2026, 8, 17, 9)));
    }

    /// "Solo esta" quita la ocurrencia original y deja el evento independiente.
    #[test]
    fn editar_solo_esta_separa_la_ocurrencia() {
        let c = db::en_memoria();
        let id = serie(&c);

        let reemplazo = base(&c, "Clase de redes (sala 401)", momento(2026, 8, 17, 11));
        excluir(&c, id, "2026-08-17 09:00", Some(reemplazo)).unwrap();

        let quedan = ocurrencias_de(&c, id);
        assert_eq!(quedan.len(), 4, "la original ya no la produce la serie");
        assert!(!quedan.contains(&momento(2026, 8, 17, 9)));

        let override_id: i64 = c
            .query_row("SELECT override_id FROM excepcion", [], |f| f.get(0))
            .unwrap();
        let suelto = evento::leer(&c, override_id).unwrap();
        assert_eq!(suelto.titulo, "Clase de redes (sala 401)");
        assert_eq!(suelto.inicio, momento(2026, 8, 17, 11));
        assert!(suelto.rrule.is_none(), "una ocurrencia separada no se repite");
    }

    /// Deshacer una separación devuelve la ocurrencia y se lleva el evento suelto.
    #[test]
    fn deshacer_una_separacion_devuelve_la_ocurrencia() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let id = serie(&c);

        let reemplazo = base(&c, "Clase movida", momento(2026, 8, 17, 11));
        h.registrar(excluir(&c, id, "2026-08-17 09:00", Some(reemplazo)).unwrap());

        let override_id: i64 = c
            .query_row("SELECT override_id FROM excepcion", [], |f| f.get(0))
            .unwrap();

        h.deshacer(&c).unwrap();

        assert_eq!(cuantas_excepciones(&c), 0);
        assert!(matches!(evento::leer(&c, override_id), Err(Error::NoExiste)));
        assert!(ocurrencias_de(&c, id).contains(&momento(2026, 8, 17, 9)));
    }

    /// Y rehacerla la separa de nuevo, con el mismo id.
    #[test]
    fn rehacer_una_separacion_vuelve_a_separarla() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let id = serie(&c);

        let reemplazo = base(&c, "Clase movida", momento(2026, 8, 17, 11));
        h.registrar(excluir(&c, id, "2026-08-17 09:00", Some(reemplazo)).unwrap());

        let antes: i64 = c
            .query_row("SELECT override_id FROM excepcion", [], |f| f.get(0))
            .unwrap();

        h.deshacer(&c).unwrap();
        h.rehacer(&c).unwrap();

        let despues: i64 = c
            .query_row("SELECT override_id FROM excepcion", [], |f| f.get(0))
            .unwrap();
        assert_eq!(antes, despues, "el evento separado vuelve con su id");
        assert_eq!(evento::leer(&c, despues).unwrap().titulo, "Clase movida");
        assert!(!ocurrencias_de(&c, id).contains(&momento(2026, 8, 17, 9)));
    }

    /// Deshacer un borrado de ocurrencia no inventa un reemplazo que nunca hubo.
    #[test]
    fn deshacer_un_borrado_de_ocurrencia_no_deja_evento_suelto() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let id = serie(&c);

        h.registrar(excluir(&c, id, "2026-08-17 09:00", None).unwrap());
        h.deshacer(&c).unwrap();
        h.rehacer(&c).unwrap();

        let override_id: Option<i64> = c
            .query_row("SELECT override_id FROM excepcion", [], |f| f.get(0))
            .unwrap();
        assert_eq!(override_id, None);
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM evento", [], |f| f.get::<_, i64>(0))
                .unwrap(),
            1,
            "solo existe la serie"
        );
    }

    /// Borrar el evento separado deja la ocurrencia borrada, no la hace volver.
    #[test]
    fn borrar_el_reemplazo_deja_la_ocurrencia_borrada() {
        let c = db::en_memoria();
        let id = serie(&c);

        let reemplazo = base(&c, "Clase movida", momento(2026, 8, 17, 11));
        excluir(&c, id, "2026-08-17 09:00", Some(reemplazo)).unwrap();

        let override_id: i64 = c
            .query_row("SELECT override_id FROM excepcion", [], |f| f.get(0))
            .unwrap();
        evento::borrar(&c, override_id).unwrap();

        assert_eq!(cuantas_excepciones(&c), 1, "la excepción se queda");
        let quedo: Option<i64> = c
            .query_row("SELECT override_id FROM excepcion", [], |f| f.get(0))
            .unwrap();
        assert_eq!(quedo, None);
        assert!(!ocurrencias_de(&c, id).contains(&momento(2026, 8, 17, 9)));
    }

    /// Borrar la serie entera se lleva sus excepciones y su evento separado queda.
    #[test]
    fn excluir_en_un_evento_sin_regla_es_error() {
        let c = db::en_memoria();
        let suelto = evento::insertar(&c, base(&c, "Dentista", momento(2026, 8, 5, 16))).unwrap();

        assert!(matches!(
            excluir(&c, suelto, "2026-08-05 16:00", None),
            Err(Error::NoEsUnaSerie(_))
        ));
    }

    /// Dos excepciones para la misma ocurrencia no pueden existir.
    #[test]
    fn no_se_puede_excluir_dos_veces_la_misma_ocurrencia() {
        let c = db::en_memoria();
        let id = serie(&c);

        excluir(&c, id, "2026-08-17 09:00", None).unwrap();
        assert!(excluir(&c, id, "2026-08-17 09:00", None).is_err());
    }
}
