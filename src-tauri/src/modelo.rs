//! Los tipos que viajan entre la base y el resto del programa.

use std::fmt;

use chrono::NaiveDateTime;
use chrono_tz::Tz;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// El único formato de fecha y hora del proyecto.
pub const FORMATO: &str = "%Y-%m-%d %H:%M";

/// Escribe una fecha para la interfaz, en el formato único del proyecto.
pub fn serializar_fecha<S>(fecha: &NaiveDateTime, serializador: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    serializador.serialize_str(&fecha.format(FORMATO).to_string())
}

pub fn serializar_fecha_opcional<S>(
    fecha: &Option<NaiveDateTime>,
    serializador: S,
) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match fecha {
        Some(f) => serializar_fecha(f, serializador),
        None => serializador.serialize_none(),
    }
}

/// Un grupo tal como está en la base.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Grupo {
    pub id: i64,
    pub nombre: String,
    pub color: String,
    pub orden: i64,
    pub es_default: bool,
}

/// Lo que hace falta para crear un grupo.
#[derive(Debug, Clone)]
pub struct GrupoNuevo {
    pub nombre: String,
    pub color: String,
}

/// Qué significa la hora de un evento.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cuando {
    /// Un día es un día. No elige tipo de hora.
    TodoElDia,
    /// Las 18:00 son las 18:00 siempre.
    Fija,
    /// La hora está escrita en esta zona y hay que traerla a la del equipo.
    Adaptable(Tz),
}

impl Cuando {
    /// La zona de origen no cruza a la interfaz: no la usa para nada.
    pub fn como_texto(self) -> &'static str {
        match self {
            Cuando::TodoElDia => "todo_el_dia",
            Cuando::Fija => "fija",
            Cuando::Adaptable(_) => "adaptable",
        }
    }
}

/// Afecta solo a la apariencia: la barra del borde izquierdo del evento.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Importancia {
    Comun,
    Importante,
    Urgente,
}

impl Importancia {
    pub fn como_texto(self) -> &'static str {
        match self {
            Importancia::Comun => "comun",
            Importancia::Importante => "importante",
            Importancia::Urgente => "urgente",
        }
    }

    pub fn desde_texto(texto: &str) -> Result<Self, Error> {
        match texto {
            "comun" => Ok(Importancia::Comun),
            "importante" => Ok(Importancia::Importante),
            "urgente" => Ok(Importancia::Urgente),
            otro => Err(Error::DatoCorrupto(format!("importancia '{otro}'"))),
        }
    }
}

/// Por el canal viaja el mismo texto que guarda la base.
impl Serialize for Importancia {
    fn serialize<S>(&self, serializador: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializador.serialize_str(self.como_texto())
    }
}

impl<'de> Deserialize<'de> for Importancia {
    fn deserialize<D>(deserializador: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let texto = String::deserialize(deserializador)?;
        Importancia::desde_texto(&texto).map_err(serde::de::Error::custom)
    }
}

/// Qué parte de la imagen se conserva, en fracciones de 0 a 1.
///
/// Va en fracciones y no en píxeles porque quien lo elige mira una versión
/// reducida: los píxeles de esa vista no son los del archivo.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Recorte {
    pub x: f32,
    pub y: f32,
    pub ancho: f32,
    pub alto: f32,
}

/// La imagen del evento y su miniatura, que van siempre juntas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Imagen {
    pub original: String,
    pub miniatura: String,
}

/// Un evento tal como está en la base.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evento {
    pub id: i64,
    pub grupo_id: i64,
    pub titulo: String,
    pub inicio: NaiveDateTime,
    /// Nulo significa "sin fin declarado", NO "todo el día".
    pub fin: Option<NaiveDateTime>,
    pub cuando: Cuando,
    pub importancia: Importancia,
    /// Nulo hereda el color del grupo.
    pub color: Option<String>,
    pub descripcion: Option<String>,
    pub ubicacion: Option<String>,
    pub url: Option<String>,
    pub imagen: Option<Imagen>,
    pub rrule: Option<String>,
    pub recordatorio_min: Option<i64>,
    pub creado: NaiveDateTime,
    pub modificado: NaiveDateTime,
}

/// Lo que hace falta para crear un evento. Las marcas de tiempo las pone la base.
#[derive(Debug, Clone)]
pub struct EventoNuevo {
    pub grupo_id: i64,
    pub titulo: String,
    pub inicio: NaiveDateTime,
    pub fin: Option<NaiveDateTime>,
    pub cuando: Cuando,
    pub importancia: Importancia,
    pub color: Option<String>,
    pub descripcion: Option<String>,
    pub ubicacion: Option<String>,
    pub url: Option<String>,
    pub imagen: Option<Imagen>,
    pub rrule: Option<String>,
    pub recordatorio_min: Option<i64>,
    /// Van acá y no aparte para que crear una ocurrencia suelta los lleve por
    /// el mismo camino que crear un evento nuevo.
    pub adjuntos: Vec<Adjunto>,
    /// El identificador que trae un archivo `.calev` importado.
    ///
    /// Vacío en todo lo demás, y entonces lo genera la base. Un evento importado
    /// adopta el del archivo: es el mismo evento, y así una sola consulta
    /// reconoce tanto reimportar el archivo como importar uno hecho desde algo
    /// que ya se tiene.
    pub uid: Option<String>,
}

/// Un archivo colgado de un evento.
///
/// Sin identificador: ninguna otra tabla apunta a un adjunto, así que
/// conservarlo al restaurar sería un segundo camino para llenar la misma tabla.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Adjunto {
    pub ruta: String,
    pub nombre_original: String,
    pub tamano: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Excepcion {
    pub fecha_original: String,
    pub override_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notificacion {
    pub id: i64,
    pub ocurrencia: String,
    pub momento: String,
    pub estado: String,
}

/// Un evento con todo lo que cuelga de él.
///
/// Es lo que hace falta para devolverlo tal cual estaba: la fila del evento se
/// borra con cascada, así que quien quiera revertir un borrado necesita también
/// lo que la cascada se llevó.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventoCompleto {
    pub evento: Evento,
    pub adjuntos: Vec<Adjunto>,
    pub excepciones: Vec<Excepcion>,
    pub notificaciones: Vec<Notificacion>,
}

/// Todo lo que puede salir mal en una operación sobre los datos.
#[derive(Debug)]
pub enum Error {
    Sqlite(rusqlite::Error),
    NoExiste,
    GrupoPorDefectoProtegido,
    /// La base contiene algo que el esquema debería haber impedido.
    DatoCorrupto(String),
    /// La regla de repetición usa algo fuera del subconjunto soportado.
    ReglaInvalida(String),
    /// El sistema no reporta una zona horaria que se pueda nombrar.
    ZonaDelEquipo(String),
    /// Se pidió tocar una ocurrencia suelta de un evento que no se repite.
    NoEsUnaSerie(i64),
    /// El orden recibido no nombra exactamente a los grupos que existen.
    OrdenIncompleto,
    /// Algo salió mal leyendo o escribiendo un archivo de la carpeta de datos.
    Archivo(String),
}

impl From<rusqlite::Error> for Error {
    fn from(e: rusqlite::Error) -> Self {
        Error::Sqlite(e)
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Sqlite(e) => write!(f, "error de base de datos: {e}"),
            Error::NoExiste => write!(f, "el registro no existe"),
            Error::GrupoPorDefectoProtegido => {
                write!(f, "el grupo por defecto no se puede borrar ni renombrar")
            }
            Error::DatoCorrupto(que) => write!(f, "dato inválido en la base: {que}"),
            Error::ReglaInvalida(que) => write!(f, "regla de repetición inválida: {que}"),
            Error::ZonaDelEquipo(que) => {
                write!(f, "no se pudo determinar la zona horaria del equipo: {que}")
            }
            Error::NoEsUnaSerie(id) => {
                write!(f, "el evento {id} no se repite: no tiene ocurrencias sueltas")
            }
            Error::OrdenIncompleto => write!(
                f,
                "el orden recibido no nombra exactamente a los grupos que existen"
            ),
            Error::Archivo(que) => write!(f, "{que}"),
        }
    }
}

impl std::error::Error for Error {}
