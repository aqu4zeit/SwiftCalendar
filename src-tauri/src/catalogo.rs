//! Todos los eventos guardados, sin pasar por la consulta de rango.
//!
//! La consulta única de rango (decisión 51) contesta qué cae cada día de un
//! rango. Acá se contestan las otras dos preguntas que nacieron con el panel de
//! control y el buscador: qué hay guardado en total, y qué eventos tocan un mes
//! con una sola fila por evento.
//!
//! Todo lo de este archivo mira la hora guardada, no la resuelta: un evento
//! pertenece al mes en que está escrito. Es un solo criterio para la lista y
//! para las flechas, y así ninguna página que las flechas ofrecen sale vacía.

use std::collections::HashMap;

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};
use chrono_tz::Tz;
use rusqlite::Connection;
use serde::Serialize;

use crate::evento;
use crate::grupo;
use crate::hora::{self, Tramo};
use crate::modelo::{self, Cuando, Error, Evento, Importancia};
use crate::recurrencia;

/// Cómo viaja un mes por el borde. Un día concreto no significa nada acá.
const FORMATO_MES: &str = "%Y-%m";

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

    /// La ocurrencia que esta fila representa, en hora guardada. Es la clave con
    /// la que se abre su ficha.
    #[serde(serialize_with = "modelo::serializar_fecha")]
    pub ocurrencia: NaiveDateTime,

    /// Hora de reloj del equipo, igual que la que muestra el calendario.
    #[serde(serialize_with = "modelo::serializar_fecha")]
    pub inicio: NaiveDateTime,
    #[serde(serialize_with = "modelo::serializar_fecha_opcional")]
    pub fin: Option<NaiveDateTime>,
    pub todo_el_dia: bool,

    /// La regla en texto. La interfaz ya sabe leerla.
    pub rrule: Option<String>,
}

/// Una página del buscador: un mes, sus eventos y los meses vecinos.
#[derive(Debug, Clone, Serialize)]
pub struct Pagina {
    /// El mes que se muestra, en `AAAA-MM`.
    pub mes: String,
    pub eventos: Vec<Resumen>,
    /// Los meses vecinos que tienen algo que mostrar. `None` es que no hay, y
    /// es lo que apaga cada flecha.
    pub anterior: Option<String>,
    pub siguiente: Option<String>,
}

/// El primer día del mes de una fecha.
fn mes_de(fecha: NaiveDateTime) -> Result<NaiveDate, Error> {
    fecha
        .date()
        .with_day(1)
        .ok_or_else(|| Error::DatoCorrupto(format!("el mes de {fecha} no existe")))
}

/// El primer día del mes siguiente.
fn mes_siguiente(mes: NaiveDate) -> Result<NaiveDate, Error> {
    let (anio, numero) = match mes.month() {
        12 => (mes.year() + 1, 1),
        otro => (mes.year(), otro + 1),
    };

    NaiveDate::from_ymd_opt(anio, numero, 1)
        .ok_or_else(|| Error::DatoCorrupto(format!("no hay mes después de {mes}")))
}

/// El último día del mes.
fn fin_de_mes(mes: NaiveDate) -> Result<NaiveDate, Error> {
    Ok(mes_siguiente(mes)? - Duration::days(1))
}

/// Un mes escrito como lo espera la interfaz.
fn texto_de_mes(mes: NaiveDate) -> String {
    mes.format(FORMATO_MES).to_string()
}

/// Lee un mes de la interfaz. Falla si no tiene la forma `AAAA-MM`.
pub fn mes_desde_texto(texto: &str) -> Result<NaiveDate, Error> {
    NaiveDate::parse_from_str(&format!("{texto}-01"), "%Y-%m-%d")
        .map_err(|_| Error::DatoCorrupto(format!("el mes '{texto}' no tiene la forma AAAA-MM")))
}

/// Sin acentos y en minúsculas, para que "manana" encuentre "Mañana".
///
/// Es la misma normalización que hace la interfaz descomponiendo en NFD: se
/// queda la letra y se van los signos de encima.
fn plano(texto: &str) -> String {
    texto
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            otro => otro,
        })
        .collect()
}

/// Los nombres y colores de los grupos, por identificador.
fn grupos_por_id(conexion: &Connection) -> Result<HashMap<i64, (String, String)>, Error> {
    Ok(grupo::listar(conexion)?
        .into_iter()
        .map(|g| (g.id, (g.nombre, g.color)))
        .collect())
}

/// Una fila, a partir del evento y de la ocurrencia que la representa.
fn armar(
    e: &Evento,
    ocurrencia: NaiveDateTime,
    grupos: &HashMap<i64, (String, String)>,
    zona_local: Tz,
) -> Result<Resumen, Error> {
    let (nombre_grupo, color_grupo) = grupos.get(&e.grupo_id).ok_or_else(|| {
        Error::DatoCorrupto(format!(
            "el evento {} apunta al grupo {}, que no existe",
            e.id, e.grupo_id
        ))
    })?;

    // El tramo se mueve entero con la ocurrencia: dura lo mismo caiga donde caiga.
    let duracion = match e.fin {
        Some(fin) => fin - e.inicio,
        None => Duration::zero(),
    };

    let resuelto = hora::resolver(
        Tramo {
            inicio: ocurrencia,
            fin: e.fin.map(|_| ocurrencia + duracion),
            cuando: e.cuando,
        },
        zona_local,
    );

    Ok(Resumen {
        evento_id: e.id,
        titulo: e.titulo.clone(),
        grupo_id: e.grupo_id,
        grupo: nombre_grupo.clone(),
        color: e.color.clone().unwrap_or_else(|| color_grupo.clone()),
        importancia: e.importancia,
        ocurrencia,
        inicio: resuelto.inicio,
        fin: resuelto.fin,
        todo_el_dia: e.cuando == Cuando::TodoElDia,
        rrule: e.rrule.clone(),
    })
}

/// Todos los eventos guardados, del más antiguo al más nuevo.
///
/// Una serie es una fila, con su fecha de inicio: es lo que hay en la tabla.
pub fn todos(conexion: &Connection, zona_local: Tz) -> Result<Vec<Resumen>, Error> {
    let grupos = grupos_por_id(conexion)?;

    evento::listar_todos(conexion)?
        .into_iter()
        .map(|e| armar(&e, e.inicio, &grupos, zona_local))
        .collect()
}

/// De las ocurrencias que un evento tiene en un mes, la que lo representa.
///
/// En un mes cualquiera es la primera. En el mes en curso es la primera que
/// todavía no pasó, y si todas pasaron, la última: el evento estuvo en ese mes y
/// esconderlo sería mentir sobre lo que hay.
fn representante(ocurrencias: &[NaiveDateTime], hoy: Option<NaiveDate>) -> Option<NaiveDateTime> {
    match hoy {
        None => ocurrencias.first().copied(),
        Some(hoy) => ocurrencias
            .iter()
            .find(|f| f.date() >= hoy)
            .or_else(|| ocurrencias.last())
            .copied(),
    }
}

/// Los eventos que tocan un mes, uno por evento.
fn del_mes(
    conexion: &Connection,
    eventos: &[Evento],
    mes: NaiveDate,
    hoy: NaiveDate,
    zona_local: Tz,
) -> Result<Vec<Resumen>, Error> {
    let grupos = grupos_por_id(conexion)?;
    let ultimo = fin_de_mes(mes)?;
    let en_curso = mes.year() == hoy.year() && mes.month() == hoy.month();

    let mut filas = Vec::new();
    for e in eventos {
        // Un evento pertenece al mes en que EMPIEZA. La consulta de ocurrencias
        // devuelve además el suelto cuyo tramo solo cruza el rango, y eso lo
        // pondría en dos páginas mientras que una serie multi-día saldría en
        // una: el filtro deja un criterio único para las filas y las flechas.
        let ocurrencias: Vec<NaiveDateTime> = recurrencia::ocurrencias(conexion, e, mes, ultimo)?
            .into_iter()
            .filter(|f| f.date() >= mes && f.date() <= ultimo)
            .collect();

        let Some(elegida) = representante(&ocurrencias, en_curso.then_some(hoy)) else {
            continue;
        };

        filas.push(armar(e, elegida, &grupos, zona_local)?);
    }

    filas.sort_by(|a, b| a.inicio.cmp(&b.inicio).then(a.evento_id.cmp(&b.evento_id)));
    Ok(filas)
}

/// El primer mes con eventos que empieza en `desde` o después.
fn mes_hacia_adelante(
    conexion: &Connection,
    eventos: &[Evento],
    desde: NaiveDate,
) -> Result<Option<NaiveDate>, Error> {
    let mut primera: Option<NaiveDateTime> = None;

    for e in eventos {
        if let Some(f) = recurrencia::primera_desde(conexion, e, desde)? {
            primera = Some(primera.map_or(f, |a| a.min(f)));
        }
    }

    primera.map(mes_de).transpose()
}

/// El último mes con eventos que termina en `hasta` o antes.
fn mes_hacia_atras(
    conexion: &Connection,
    eventos: &[Evento],
    hasta: NaiveDate,
) -> Result<Option<NaiveDate>, Error> {
    let mut ultima: Option<NaiveDateTime> = None;

    for e in eventos {
        if let Some(f) = recurrencia::ultima_hasta(conexion, e, hasta)? {
            ultima = Some(ultima.map_or(f, |a| a.max(f)));
        }
    }

    ultima.map(mes_de).transpose()
}

/// La página del buscador para un mes, filtrada por lo que se haya escrito.
///
/// Si ese mes no tiene nada que mostrar se devuelve la del mes más cercano que
/// sí: primero hacia adelante, después hacia atrás. Es lo que hace que escribir
/// vaya reduciendo la lista sin dejarla nunca en una página vacía. `None` es que
/// no hay ningún evento que coincida.
pub fn pagina(
    conexion: &Connection,
    mes: NaiveDate,
    busca: &str,
    hoy: NaiveDate,
    zona_local: Tz,
) -> Result<Option<Pagina>, Error> {
    let aguja = plano(busca.trim());
    let eventos: Vec<Evento> = evento::listar_todos(conexion)?
        .into_iter()
        .filter(|e| aguja.is_empty() || plano(&e.titulo).contains(&aguja))
        .collect();

    let elegido = match mes_hacia_adelante(conexion, &eventos, mes)? {
        Some(m) => Some(m),
        None => mes_hacia_atras(conexion, &eventos, fin_de_mes(mes)?)?,
    };
    let Some(elegido) = elegido else {
        return Ok(None);
    };

    Ok(Some(Pagina {
        mes: texto_de_mes(elegido),
        eventos: del_mes(conexion, &eventos, elegido, hoy, zona_local)?,
        anterior: mes_hacia_atras(conexion, &eventos, elegido - Duration::days(1))?
            .map(texto_de_mes),
        siguiente: mes_hacia_adelante(conexion, &eventos, mes_siguiente(elegido)?)?
            .map(texto_de_mes),
    }))
}
