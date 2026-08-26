//! Operaciones sobre grupos.

use rusqlite::{Connection, OptionalExtension, Row};

use crate::historial::Accion;
use crate::modelo::{Error, Grupo, GrupoNuevo};

fn desde_fila(fila: &Row) -> rusqlite::Result<Grupo> {
    Ok(Grupo {
        id: fila.get("id")?,
        nombre: fila.get("nombre")?,
        color: fila.get("color")?,
        orden: fila.get("orden")?,
        es_default: fila.get::<_, i64>("es_default")? == 1,
    })
}

pub fn leer(conexion: &Connection, id: i64) -> Result<Grupo, Error> {
    conexion
        .query_row("SELECT * FROM grupo WHERE id = ?1", [id], desde_fila)
        .optional()?
        .ok_or(Error::NoExiste)
}

pub fn listar(conexion: &Connection) -> Result<Vec<Grupo>, Error> {
    let mut consulta = conexion.prepare("SELECT * FROM grupo ORDER BY orden, id")?;
    let filas = consulta.query_map([], desde_fila)?;
    Ok(filas.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// El grupo al que caen los eventos huérfanos. Existe desde la migración.
fn id_por_defecto(conexion: &Connection) -> Result<i64, Error> {
    Ok(conexion.query_row("SELECT id FROM grupo WHERE es_default = 1", [], |f| f.get(0))?)
}

/// Crea un grupo al final del orden actual.
pub fn crear(conexion: &Connection, nuevo: GrupoNuevo) -> Result<Accion, Error> {
    let orden: i64 = conexion.query_row("SELECT COALESCE(MAX(orden), -1) + 1 FROM grupo", [], |f| {
        f.get(0)
    })?;

    conexion.execute(
        "INSERT INTO grupo (nombre, color, orden, es_default) VALUES (?1, ?2, ?3, 0)",
        (&nuevo.nombre, &nuevo.color, orden),
    )?;

    Ok(Accion::GrupoCreado {
        id: conexion.last_insert_rowid(),
    })
}

/// Escribe un grupo completo y devuelve cómo estaba antes.
pub fn escribir(conexion: &Connection, grupo: &Grupo) -> Result<Accion, Error> {
    let antes = leer(conexion, grupo.id)?;

    conexion.execute(
        "UPDATE grupo SET nombre = ?1, color = ?2, orden = ?3 WHERE id = ?4",
        (&grupo.nombre, &grupo.color, grupo.orden, grupo.id),
    )?;

    Ok(Accion::GrupoEditado { antes })
}

/// Edita un grupo desde la interfaz.
pub fn editar(conexion: &Connection, grupo: &Grupo) -> Result<Accion, Error> {
    let actual = leer(conexion, grupo.id)?;

    if actual.es_default && actual.nombre != grupo.nombre {
        return Err(Error::GrupoPorDefectoProtegido);
    }

    escribir(conexion, grupo)
}

/// Borra un grupo y mueve sus eventos al grupo por defecto.
pub fn borrar(conexion: &Connection, id: i64) -> Result<Accion, Error> {
    let grupo = leer(conexion, id)?;

    if grupo.es_default {
        return Err(Error::GrupoPorDefectoProtegido);
    }

    let tx = conexion.unchecked_transaction()?;

    let eventos: Vec<i64> = {
        let mut consulta = tx.prepare("SELECT id FROM evento WHERE grupo_id = ?1")?;
        let filas = consulta.query_map([id], |f| f.get(0))?;
        filas.collect::<rusqlite::Result<Vec<_>>>()?
    };

    tx.execute(
        "UPDATE evento SET grupo_id = ?1 WHERE grupo_id = ?2",
        (id_por_defecto(&tx)?, id),
    )?;
    tx.execute("DELETE FROM grupo WHERE id = ?1", [id])?;

    tx.commit()?;

    Ok(Accion::GrupoBorrado { grupo, eventos })
}

/// Escribe el orden de los grupos y devuelve el que tenían.
///
/// Recibe todos los identificadores, no un movimiento: un orden parcial dejaría
/// grupos con el número viejo y dos podrían quedar empatados.
pub fn reordenar(conexion: &Connection, ids: &[i64]) -> Result<Accion, Error> {
    let antes: Vec<i64> = listar(conexion)?.into_iter().map(|g| g.id).collect();

    let mismos = ids.len() == antes.len() && antes.iter().all(|id| ids.contains(id));
    if !mismos {
        return Err(Error::OrdenIncompleto);
    }

    let tx = conexion.unchecked_transaction()?;
    for (posicion, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE grupo SET orden = ?1 WHERE id = ?2",
            (posicion as i64, id),
        )?;
    }
    tx.commit()?;

    Ok(Accion::GruposReordenados { antes })
}

/// Devuelve un grupo borrado y le reasigna sus eventos.
pub fn restaurar(conexion: &Connection, grupo: &Grupo, eventos: &[i64]) -> Result<Accion, Error> {
    let tx = conexion.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO grupo (id, nombre, color, orden, es_default) VALUES (?1, ?2, ?3, ?4, 0)",
        (grupo.id, &grupo.nombre, &grupo.color, grupo.orden),
    )?;

    for evento in eventos {
        tx.execute(
            "UPDATE evento SET grupo_id = ?1 WHERE id = ?2",
            (grupo.id, evento),
        )?;
    }

    tx.commit()?;

    Ok(Accion::GrupoCreado { id: grupo.id })
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db;
    use crate::historial::Historial;

    fn nuevo(nombre: &str) -> GrupoNuevo {
        GrupoNuevo {
            nombre: nombre.to_string(),
            color: "#cf8f3c".to_string(),
        }
    }

    /// Crea un evento sin pasar por el módulo de eventos, que todavía no existe.
    fn evento_suelto(conexion: &Connection, grupo_id: i64) -> i64 {
        conexion
            .execute(
                "INSERT INTO evento (grupo_id, titulo, inicio, creado, modificado)
                 VALUES (?1, 'prueba', '2026-08-12 18:00', '2026-08-09 00:00', '2026-08-09 00:00')",
                [grupo_id],
            )
            .unwrap();
        conexion.last_insert_rowid()
    }

    #[test]
    fn la_migracion_deja_el_grupo_por_defecto() {
        let c = db::en_memoria();
        let grupos = listar(&c).unwrap();

        assert_eq!(grupos.len(), 1);
        assert_eq!(grupos[0].nombre, "Otro");
        assert!(grupos[0].es_default);
    }

    #[test]
    fn crear_y_deshacer_deja_la_base_como_estaba() {
        let c = db::en_memoria();
        let mut h = Historial::default();

        h.registrar(crear(&c, nuevo("Universidad")).unwrap());
        assert_eq!(listar(&c).unwrap().len(), 2);

        assert!(h.deshacer(&c).unwrap());
        assert_eq!(listar(&c).unwrap().len(), 1);
    }

    #[test]
    fn editar_se_deshace_y_se_rehace() {
        let c = db::en_memoria();
        let mut h = Historial::default();

        let Accion::GrupoCreado { id } = crear(&c, nuevo("Universidad")).unwrap() else {
            panic!("crear debe devolver GrupoCreado");
        };

        let mut cambiado = leer(&c, id).unwrap();
        cambiado.nombre = "Universidad 2026".to_string();
        h.registrar(editar(&c, &cambiado).unwrap());
        assert_eq!(leer(&c, id).unwrap().nombre, "Universidad 2026");

        h.deshacer(&c).unwrap();
        assert_eq!(leer(&c, id).unwrap().nombre, "Universidad");

        h.rehacer(&c).unwrap();
        assert_eq!(leer(&c, id).unwrap().nombre, "Universidad 2026");
    }

    /// Borrar un grupo nunca borra eventos: los mueve al grupo por defecto.
    #[test]
    fn borrar_un_grupo_mueve_sus_eventos_a_otro() {
        let c = db::en_memoria();

        let Accion::GrupoCreado { id } = crear(&c, nuevo("Juegos")).unwrap() else {
            panic!()
        };
        let evento = evento_suelto(&c, id);

        borrar(&c, id).unwrap();

        let destino: i64 = c
            .query_row("SELECT grupo_id FROM evento WHERE id = ?1", [evento], |f| {
                f.get(0)
            })
            .unwrap();
        assert_eq!(destino, id_por_defecto(&c).unwrap());
    }

    /// Deshacer un borrado devuelve el grupo con su id y sus eventos.
    #[test]
    fn deshacer_un_borrado_devuelve_grupo_y_eventos() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let defecto = id_por_defecto(&c).unwrap();

        let Accion::GrupoCreado { id } = crear(&c, nuevo("Juegos")).unwrap() else {
            panic!()
        };
        let mio = evento_suelto(&c, id);
        let ajeno = evento_suelto(&c, defecto);

        h.registrar(borrar(&c, id).unwrap());
        h.deshacer(&c).unwrap();

        assert_eq!(leer(&c, id).unwrap().nombre, "Juegos");

        let grupo_de = |e: i64| -> i64 {
            c.query_row("SELECT grupo_id FROM evento WHERE id = ?1", [e], |f| f.get(0))
                .unwrap()
        };
        assert_eq!(grupo_de(mio), id, "el evento vuelve a su grupo");
        assert_eq!(grupo_de(ajeno), defecto, "el ajeno no se mueve");
    }

    /// Reordenar y deshacer devuelve el orden anterior.
    #[test]
    fn reordenar_se_deshace() {
        let c = db::en_memoria();
        let mut h = Historial::default();

        let Accion::GrupoCreado { id: uni } = crear(&c, nuevo("Universidad")).unwrap() else {
            panic!()
        };
        let Accion::GrupoCreado { id: juegos } = crear(&c, nuevo("Juegos")).unwrap() else {
            panic!()
        };
        let defecto = id_por_defecto(&c).unwrap();

        let orden = |c: &Connection| -> Vec<i64> {
            listar(c).unwrap().into_iter().map(|g| g.id).collect()
        };
        assert_eq!(orden(&c), vec![defecto, uni, juegos]);

        h.registrar(reordenar(&c, &[juegos, defecto, uni]).unwrap());
        assert_eq!(orden(&c), vec![juegos, defecto, uni]);

        h.deshacer(&c).unwrap();
        assert_eq!(orden(&c), vec![defecto, uni, juegos]);

        h.rehacer(&c).unwrap();
        assert_eq!(orden(&c), vec![juegos, defecto, uni]);
    }

    /// Un orden que no nombra a todos los grupos se rechaza entero.
    #[test]
    fn un_orden_incompleto_es_error() {
        let c = db::en_memoria();
        let defecto = id_por_defecto(&c).unwrap();
        crear(&c, nuevo("Universidad")).unwrap();

        assert!(matches!(
            reordenar(&c, &[defecto]),
            Err(Error::OrdenIncompleto)
        ));
    }

    #[test]
    fn el_grupo_por_defecto_no_se_puede_borrar() {
        let c = db::en_memoria();
        let defecto = id_por_defecto(&c).unwrap();

        assert!(matches!(
            borrar(&c, defecto),
            Err(Error::GrupoPorDefectoProtegido)
        ));
    }

    #[test]
    fn el_grupo_por_defecto_no_se_puede_renombrar_pero_si_recolorear() {
        let c = db::en_memoria();
        let defecto = id_por_defecto(&c).unwrap();

        let mut renombrado = leer(&c, defecto).unwrap();
        renombrado.nombre = "Varios".to_string();
        assert!(matches!(
            editar(&c, &renombrado),
            Err(Error::GrupoPorDefectoProtegido)
        ));

        let mut recoloreado = leer(&c, defecto).unwrap();
        recoloreado.color = "#4f9e8c".to_string();
        assert!(editar(&c, &recoloreado).is_ok());
    }

    /// Una acción nueva invalida lo que se había deshecho.
    #[test]
    fn una_accion_nueva_vacia_la_pila_de_rehacer() {
        let c = db::en_memoria();
        let mut h = Historial::default();

        h.registrar(crear(&c, nuevo("Universidad")).unwrap());
        h.deshacer(&c).unwrap();
        assert!(h.hay_para_rehacer());

        h.registrar(crear(&c, nuevo("Casa")).unwrap());
        assert!(!h.hay_para_rehacer());
    }

    #[test]
    fn deshacer_sin_nada_pendiente_no_es_error() {
        let c = db::en_memoria();
        let mut h = Historial::default();

        assert!(!h.deshacer(&c).unwrap());
        assert!(!h.rehacer(&c).unwrap());
    }
}
