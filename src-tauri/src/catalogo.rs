//! Todos los eventos guardados, sin rango de fechas.
//!
//! La consulta única de rango (decisión 51) pide dos fechas y devuelve
//! ocurrencias: un evento repetido aparece tantas veces como veces cae. El panel
//! de control necesita lo contrario, la lista de lo que hay en la base, una fila
//! por evento guardado y sin fechas que acotar. Son dos preguntas distintas, así
//! que son dos consultas distintas.

use std::collections::HashMap;

use chrono::NaiveDateTime;
use chrono_tz::Tz;
use rusqlite::Connection;
use serde::Serialize;

use crate::evento;
use crate::grupo;
use crate::hora::{self, Tramo};
use crate::modelo::{self, Cuando, Error, Importancia};

/// Un evento guardado, con su grupo resuelto y su hora en reloj del equipo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Resumen {
    pub evento_id: i64,
    pub titulo: String,

    pub grupo_id: i64,
    pub grupo: String,
    /// Ya resuelto: el del evento si lo declara, el del grupo si no.
    pub color: String,
    pub importancia: Importancia,

    /// Hora de reloj del equipo, igual que la que muestra el calendario.
    #[serde(serialize_with = "modelo::serializar_fecha")]
    pub inicio: NaiveDateTime,
    #[serde(serialize_with = "modelo::serializar_fecha_opcional")]
    pub fin: Option<NaiveDateTime>,
    pub todo_el_dia: bool,

    /// La regla en texto. La interfaz ya sabe leerla.
    pub rrule: Option<String>,
}

/// Todos los eventos guardados, del más antiguo al más nuevo.
pub fn todos(conexion: &Connection, zona_local: Tz) -> Result<Vec<Resumen>, Error> {
    let grupos: HashMap<i64, (String, String)> = grupo::listar(conexion)?
        .into_iter()
        .map(|g| (g.id, (g.nombre, g.color)))
        .collect();

    evento::listar_todos(conexion)?
        .into_iter()
        .map(|e| {
            let (nombre_grupo, color_grupo) = grupos.get(&e.grupo_id).ok_or_else(|| {
                Error::DatoCorrupto(format!(
                    "el evento {} apunta al grupo {}, que no existe",
                    e.id, e.grupo_id
                ))
            })?;

            let resuelto = hora::resolver(
                Tramo {
                    inicio: e.inicio,
                    fin: e.fin,
                    cuando: e.cuando,
                },
                zona_local,
            );

            Ok(Resumen {
                evento_id: e.id,
                titulo: e.titulo,
                grupo_id: e.grupo_id,
                grupo: nombre_grupo.clone(),
                color: e.color.unwrap_or_else(|| color_grupo.clone()),
                importancia: e.importancia,
                inicio: resuelto.inicio,
                fin: resuelto.fin,
                todo_el_dia: e.cuando == Cuando::TodoElDia,
                rrule: e.rrule,
            })
        })
        .collect()
}
