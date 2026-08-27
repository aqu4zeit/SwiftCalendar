//! El archivo `.calev`: un evento suelto, para pasárselo a otra persona.
//!
//! Texto plano por dentro, un evento por archivo, y la imagen codificada adentro
//! en vez de viajar aparte. Lo que no viaja es lo personal —grupo, color,
//! recordatorio, excepciones y notificaciones—: eso lo decide quien recibe.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::NaiveDateTime;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::evento;
use crate::modelo::{Cuando, Error, FORMATO};

/// La versión del formato, dentro del archivo.
///
/// Va primero y es un número, no un texto: una versión futura tiene que poder
/// rechazar un archivo que no entiende en vez de leerlo a medias.
const VERSION: u32 = 1;

/// Un evento tal como viaja dentro del archivo.
///
/// Los campos son los mismos nombres que usa el resto del proyecto. Las fechas
/// son texto en el formato único, igual que en el canal de comandos: convertirlas
/// acá reintroduciría una zona horaria en un archivo que ya declara la suya.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Calev {
    pub calev: u32,
    /// El identificador del evento en el equipo que lo exportó.
    pub uid: String,
    pub titulo: String,
    pub inicio: String,
    pub fin: Option<String>,
    /// `todo_el_dia`, `fija` o `adaptable`.
    pub cuando: String,
    /// Solo cuando `cuando` es `adaptable`. Nombre IANA.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub zona_origen: Option<String>,
    pub importancia: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub descripcion: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ubicacion: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rrule: Option<String>,
    /// La imagen entera, codificada. Nulo si el evento no tiene.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imagen: Option<ImagenCalev>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImagenCalev {
    /// `png` o `jpg`, que es lo único que la aplicación guarda.
    pub formato: String,
    /// El archivo completo en base64.
    pub datos: String,
}

/// El identificador del evento, que es lo que lo hace reconocible entre equipos.
fn uid_de(conexion: &Connection, id: i64) -> Result<String, Error> {
    conexion
        .query_row("SELECT uid FROM evento WHERE id = ?1", [id], |f| f.get(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Error::NoExiste,
            otro => Error::Sqlite(otro),
        })
}

/// Arma el contenido del archivo para un evento.
///
/// `carpeta` es la de datos: la imagen se guarda como ruta relativa y hay que
/// leerla del disco para meterla adentro.
pub fn exportar(conexion: &Connection, id: i64, carpeta: &Path) -> Result<String, Error> {
    let evento = evento::leer(conexion, id)?;

    let imagen = match &evento.imagen {
        None => None,
        Some(imagen) => {
            let ruta = carpeta.join(&imagen.original);
            let bytes = fs::read(&ruta).map_err(|e| {
                Error::Archivo(format!("no se pudo leer {}: {e}", ruta.display()))
            })?;

            // El formato sale de la extensión con que se guardó, que la decisión
            // 84 dejó en solo dos posibilidades.
            let formato = match ruta.extension().and_then(|e| e.to_str()) {
                Some("png") => "png",
                Some("jpg") | Some("jpeg") => "jpg",
                otro => {
                    return Err(Error::Archivo(format!(
                        "la imagen tiene una extensión que no se comparte: {otro:?}"
                    )))
                }
            };

            Some(ImagenCalev {
                formato: formato.to_string(),
                datos: crate::archivo::base64(&bytes),
            })
        }
    };

    let calev = Calev {
        calev: VERSION,
        uid: uid_de(conexion, id)?,
        titulo: evento.titulo,
        inicio: evento.inicio.format(FORMATO).to_string(),
        fin: evento.fin.map(|f| f.format(FORMATO).to_string()),
        cuando: evento.cuando.como_texto().to_string(),
        zona_origen: match evento.cuando {
            Cuando::Adaptable(zona) => Some(zona.name().to_string()),
            _ => None,
        },
        importancia: evento.importancia.como_texto().to_string(),
        descripcion: evento.descripcion,
        ubicacion: evento.ubicacion,
        url: evento.url,
        rrule: evento.rrule,
        imagen,
    };

    serde_json::to_string_pretty(&calev)
        .map_err(|e| Error::Archivo(format!("no se pudo escribir el archivo: {e}")))
}

/// Lee un archivo y comprueba que sea un `.calev` que esta versión entiende.
pub fn leer(texto: &str) -> Result<Calev, Error> {
    let calev: Calev = serde_json::from_str(texto)
        .map_err(|e| Error::Archivo(format!("el archivo no es un .calev válido: {e}")))?;

    if calev.calev != VERSION {
        return Err(Error::Archivo(format!(
            "el archivo es de la versión {} y esta aplicación entiende la {VERSION}",
            calev.calev
        )));
    }

    // Lo que la base exigiría igual, comprobado antes de llegar a ella.
    if calev.titulo.trim().is_empty() {
        return Err(Error::Archivo("el evento no tiene título".into()));
    }
    NaiveDateTime::parse_from_str(&calev.inicio, FORMATO)
        .map_err(|_| Error::Archivo(format!("fecha de inicio inválida: {}", calev.inicio)))?;

    Ok(calev)
}

/// Si un evento con ese identificador ya está en la base.
///
/// Cubre los dos casos de una sola vez: reimportar el mismo archivo, e importar
/// uno hecho desde un evento que ya se tiene. Es la misma pregunta.
pub fn ya_esta(conexion: &Connection, uid: &str) -> Result<bool, Error> {
    let cuantos: i64 = conexion.query_row(
        "SELECT count(*) FROM evento WHERE uid = ?1",
        [uid],
        |f| f.get(0),
    )?;

    Ok(cuantos > 0)
}

/// Deja la imagen del archivo en un archivo temporal y devuelve su ruta.
///
/// El formulario que se abre prellenado espera una ruta en disco, igual que
/// cuando el usuario elige una imagen a mano. Así la imagen importada recorre el
/// mismo camino que cualquier otra —recorte, miniatura, límites— en vez de
/// tener uno propio.
pub fn imagen_a_temporal(imagen: &ImagenCalev, uid: &str) -> Result<PathBuf, Error> {
    let bytes = desde_base64(&imagen.datos)?;

    let ruta = std::env::temp_dir().join(format!("swiftcalendar-{uid}.{}", imagen.formato));
    fs::write(&ruta, bytes)
        .map_err(|e| Error::Archivo(format!("no se pudo escribir {}: {e}", ruta.display())))?;

    Ok(ruta)
}

/// El inverso de `archivo::base64`. Rechaza cualquier carácter que no sea del
/// alfabeto en vez de saltárselo: un archivo corrupto tiene que decirlo.
fn desde_base64(texto: &str) -> Result<Vec<u8>, Error> {
    fn valor(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some(u32::from(c - b'A')),
            b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let limpio: Vec<u8> = texto
        .bytes()
        .filter(|c| !c.is_ascii_whitespace() && *c != b'=')
        .collect();

    let mut salida = Vec::with_capacity(limpio.len() / 4 * 3);

    for grupo in limpio.chunks(4) {
        // Un grupo de uno no codifica ningún byte: es relleno mal escrito.
        if grupo.len() < 2 {
            return Err(Error::Archivo("la imagen del archivo está incompleta".into()));
        }

        let mut junto: u32 = 0;
        for c in grupo {
            let v = valor(*c)
                .ok_or_else(|| Error::Archivo("la imagen del archivo está corrupta".into()))?;
            junto = (junto << 6) | v;
        }
        // Los grupos incompletos se alinean a la izquierda antes de repartir.
        junto <<= 6 * (4 - grupo.len());

        salida.push((junto >> 16) as u8);
        if grupo.len() >= 3 {
            salida.push((junto >> 8) as u8);
        }
        if grupo.len() == 4 {
            salida.push(junto as u8);
        }
    }

    Ok(salida)
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn base64_ida_y_vuelta() {
        for original in [
            &b""[..],
            &b"a"[..],
            &b"ab"[..],
            &b"abc"[..],
            &b"abcd"[..],
            &[0, 0, 0][..],
            &[255, 255, 255][..],
        ] {
            let texto = crate::archivo::base64(original);
            assert_eq!(desde_base64(&texto).unwrap(), original, "con {original:?}");
        }
    }

    #[test]
    fn base64_rechaza_lo_que_no_es_del_alfabeto() {
        assert!(desde_base64("YWJ j").is_ok(), "los espacios se ignoran");
        assert!(desde_base64("YWJ*").is_err());
    }

    #[test]
    fn un_archivo_de_otra_version_se_rechaza() {
        let texto = r#"{"calev":99,"uid":"x","titulo":"t","inicio":"2026-08-13 21:30",
            "fin":null,"cuando":"fija","importancia":"comun"}"#;

        assert!(matches!(leer(texto), Err(Error::Archivo(_))));
    }

    #[test]
    fn un_archivo_sin_titulo_se_rechaza() {
        let texto = r#"{"calev":1,"uid":"x","titulo":"   ","inicio":"2026-08-13 21:30",
            "fin":null,"cuando":"fija","importancia":"comun"}"#;

        assert!(matches!(leer(texto), Err(Error::Archivo(_))));
    }

    #[test]
    fn un_archivo_minimo_se_lee() {
        let texto = r#"{"calev":1,"uid":"abc","titulo":"Cita","inicio":"2026-08-13 21:30",
            "fin":null,"cuando":"fija","importancia":"comun"}"#;

        let calev = leer(texto).unwrap();
        assert_eq!(calev.uid, "abc");
        assert_eq!(calev.titulo, "Cita");
        assert_eq!(calev.imagen, None);
    }
}
