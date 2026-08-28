//! Generación y lectura de las notificaciones.
//!
//! Una notificación es un registro persistente, no un aviso que pasa: nace
//! cuando llega su hora, queda pendiente y sigue ahí hasta que alguien la marca
//! como vista.
//!
//! Un solo procedimiento la genera, y corre en tres momentos —al abrir la app,
//! cada minuto mientras vive, y al restaurarla desde la bandeja—. No hay caso
//! especial para la app cerrada: si estuvo apagada tres días, la misma pasada
//! genera los tres días. Por eso el temporizador no es crítico; sin él solo se
//! pierde el aviso en vivo, nunca la notificación.

use chrono::{Duration, NaiveDateTime};
use chrono_tz::Tz;
use rusqlite::{params, Connection};

use crate::hora::{self, Tramo};
use crate::modelo::{Error, Evento, Importancia, FORMATO};
use crate::recurrencia;

/// La clave de ajuste que marca hasta dónde se generó.
const MARCA: &str = "generado_hasta";

/// Cuántos días de margen se le piden a la expansión de cada serie.
///
/// El motor de recurrencia recorta por el día de inicio de la ocurrencia, y el
/// aviso puede caer varios días antes: una semana de recordatorio mueve el aviso
/// del lunes al lunes anterior. El margen sale del recordatorio más largo que
/// haya en juego, no de un número fijo.
fn dias_de_margen(minutos: i64) -> i64 {
    // Hacia arriba: un recordatorio de 25 horas cruza dos días calendario.
    minutos / (60 * 24) + 2
}

/// Una notificación con lo que hace falta para mostrarla.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aviso {
    pub id: i64,
    pub evento_id: i64,
    pub titulo: String,
    pub grupo_id: i64,
    pub importancia: Importancia,
    pub ocurrencia: NaiveDateTime,
    pub momento: NaiveDateTime,
    pub vista: bool,
}

/// Genera lo que faltaba entre la última pasada y ahora.
///
/// Devuelve cuántas creó. Cero es lo normal: la mayoría de las pasadas no tienen
/// nada que hacer.
pub fn generar(conexion: &Connection, ahora: NaiveDateTime, zona: Tz) -> Result<usize, Error> {
    let desde = leer_marca(conexion)?;

    // El reloj del equipo puede haberse atrasado, o alguien puede haber movido la
    // fecha del sistema. Generar hacia atrás produciría avisos de cosas que ya
    // pasaron hace meses, así que la marca avanza y no se genera nada.
    if ahora <= desde {
        escribir_marca(conexion, ahora)?;
        return Ok(0);
    }

    let tx = conexion.unchecked_transaction()?;
    let mut creadas = 0;

    for evento in con_recordatorio(&tx)? {
        let Some(minutos) = evento.recordatorio_min else {
            continue;
        };

        for momento in avisos_entre(&tx, &evento, minutos, desde, ahora, zona)? {
            let ocurrencia = momento.ocurrencia.format(FORMATO).to_string();

            tx.execute(
                "INSERT INTO notificacion (evento_id, ocurrencia, momento)
                 VALUES (?1, ?2, ?3)",
                params![
                    evento.id,
                    ocurrencia,
                    momento.aviso.format(FORMATO).to_string()
                ],
            )?;
            creadas += 1;
        }
    }

    escribir_marca(&tx, ahora)?;
    tx.commit()?;

    Ok(creadas)
}

/// Una pasada del generador con el reloj y la zona del equipo.
///
/// La zona solo se le pide al sistema si algún evento con recordatorio es
/// adaptable. Un equipo que no sabe en qué zona está no puede resolver esos
/// eventos, pero tampoco tiene por qué impedir que avisen los demás.
pub fn pasada(conexion: &Connection) -> Result<usize, Error> {
    let ahora = chrono::Local::now().naive_local();

    let zona = if alguno_es_adaptable(conexion)? {
        hora::zona_del_equipo()?
    } else {
        // Ningún evento la va a consultar: `resolver` la ignora salvo en el caso
        // adaptable, y acá no hay ninguno.
        Tz::UTC
    };

    generar(conexion, ahora, zona)
}

/// Una ocurrencia y el instante en que debe avisar.
struct Momento {
    ocurrencia: NaiveDateTime,
    aviso: NaiveDateTime,
}

/// Los avisos de un evento que caen en `(desde, hasta]`.
///
/// El intervalo excluye su inicio: `desde` ya se generó en la pasada anterior, y
/// volver a incluirlo chocaría contra la unicidad de la tabla.
fn avisos_entre(
    conexion: &Connection,
    evento: &Evento,
    minutos: i64,
    desde: NaiveDateTime,
    hasta: NaiveDateTime,
    zona: Tz,
) -> Result<Vec<Momento>, Error> {
    let recordatorio = Duration::minutes(minutos);
    let margen = Duration::days(dias_de_margen(minutos));

    // Se busca por la ocurrencia, no por el aviso: el motor expande fechas de
    // inicio. El aviso de una ocurrencia cae `recordatorio` antes, así que las
    // candidatas están en la ventana corrida hacia adelante.
    let ventana_desde = (desde + recordatorio - margen).date();
    let ventana_hasta = (hasta + recordatorio + margen).date();

    let ocurrencias = recurrencia::ocurrencias(conexion, evento, ventana_desde, ventana_hasta)?;

    Ok(ocurrencias
        .into_iter()
        .filter_map(|ocurrencia| {
            // Un evento adaptable avisa según la hora que muestra hoy, no la que
            // tenía cuando se creó.
            let visible = hora::resolver(
                Tramo {
                    inicio: ocurrencia,
                    fin: None,
                    cuando: evento.cuando,
                },
                zona,
            )
            .inicio;

            let aviso = visible - recordatorio;
            (aviso > desde && aviso <= hasta).then_some(Momento { ocurrencia, aviso })
        })
        .collect())
}

/// Los eventos que piden recordatorio. Los demás no generan nada.
fn con_recordatorio(conexion: &Connection) -> Result<Vec<Evento>, Error> {
    let mut consulta =
        conexion.prepare("SELECT * FROM evento WHERE recordatorio_min IS NOT NULL")?;
    // Doble `Result`: rusqlite envuelve el suyo y `desde_fila` devuelve el del
    // proyecto. El mismo patrón que usa la consulta de rango.
    let filas = consulta.query_map([], |f| Ok(crate::evento::desde_fila(f)))?;

    filas
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .collect()
}

fn leer_marca(conexion: &Connection) -> Result<NaiveDateTime, Error> {
    let texto: String = conexion.query_row(
        "SELECT valor FROM ajuste WHERE clave = ?1",
        [MARCA],
        |f| f.get(0),
    )?;

    NaiveDateTime::parse_from_str(&texto, FORMATO)
        .map_err(|_| Error::DatoCorrupto(format!("{MARCA} vale '{texto}'")))
}

fn escribir_marca(conexion: &Connection, momento: NaiveDateTime) -> Result<(), Error> {
    conexion.execute(
        "UPDATE ajuste SET valor = ?1 WHERE clave = ?2",
        params![momento.format(FORMATO).to_string(), MARCA],
    )?;
    Ok(())
}

/// Todas las notificaciones, las pendientes primero y dentro de cada grupo las
/// más recientes arriba.
pub fn listar(conexion: &Connection) -> Result<Vec<Aviso>, Error> {
    let mut consulta = conexion.prepare(
        "SELECT n.id, n.evento_id, n.ocurrencia, n.momento, n.estado,
                e.titulo, e.grupo_id, e.importancia
         FROM notificacion n
         JOIN evento e ON e.id = n.evento_id
         ORDER BY n.estado = 'vista', n.momento DESC",
    )?;

    // La fila viaja cruda y se convierte afuera: `Importancia::desde_texto` y el
    // análisis de fechas devuelven el error del proyecto, no el de rusqlite, y
    // dentro del cierre no hay dónde ponerlo.
    let filas = consulta.query_map([], |f| {
        Ok(Cruda {
            id: f.get::<_, i64>("id")?,
            evento_id: f.get::<_, i64>("evento_id")?,
            titulo: f.get::<_, String>("titulo")?,
            grupo_id: f.get::<_, i64>("grupo_id")?,
            importancia: f.get::<_, String>("importancia")?,
            ocurrencia: f.get::<_, String>("ocurrencia")?,
            momento: f.get::<_, String>("momento")?,
            estado: f.get::<_, String>("estado")?,
        })
    })?;

    let mut avisos = Vec::new();
    for fila in filas {
        let c = fila?;

        avisos.push(Aviso {
            id: c.id,
            evento_id: c.evento_id,
            titulo: c.titulo,
            grupo_id: c.grupo_id,
            importancia: Importancia::desde_texto(&c.importancia)?,
            ocurrencia: fecha(&c.ocurrencia)?,
            momento: fecha(&c.momento)?,
            vista: c.estado == "vista",
        });
    }

    Ok(avisos)
}

/// Una fila de la consulta, con todo en el tipo que da la base.
struct Cruda {
    id: i64,
    evento_id: i64,
    titulo: String,
    grupo_id: i64,
    importancia: String,
    ocurrencia: String,
    momento: String,
    estado: String,
}

fn fecha(texto: &str) -> Result<NaiveDateTime, Error> {
    NaiveDateTime::parse_from_str(texto, FORMATO)
        .map_err(|_| Error::DatoCorrupto(format!("fecha de notificación '{texto}'")))
}

/// Cuántas esperan. Es lo que decide si la campana lleva marca.
pub fn pendientes(conexion: &Connection) -> Result<i64, Error> {
    Ok(conexion.query_row(
        "SELECT COUNT(*) FROM notificacion WHERE estado = 'pendiente'",
        [],
        |f| f.get(0),
    )?)
}

/// Marca una como vista. Marcar la que ya lo está no es un error.
pub fn marcar_vista(conexion: &Connection, id: i64) -> Result<(), Error> {
    let filas = conexion.execute(
        "UPDATE notificacion SET estado = 'vista' WHERE id = ?1",
        [id],
    )?;

    if filas == 0 {
        return Err(Error::NoExiste);
    }

    Ok(())
}

/// Marca todas las pendientes como vistas y devuelve cuántas eran.
pub fn marcar_todas_vistas(conexion: &Connection) -> Result<usize, Error> {
    Ok(conexion.execute(
        "UPDATE notificacion SET estado = 'vista' WHERE estado = 'pendiente'",
        [],
    )?)
}

/// Borra una notificación ya vista.
///
/// Solo las vistas: una pendiente todavía no la miró nadie, y dejar que se borre
/// desde la lista permite descartar sin leer con un clic mal puesto. La decisión
/// 19 dice que no caducan solas, no que el usuario no pueda quitarlas.
pub fn borrar(conexion: &Connection, id: i64) -> Result<(), Error> {
    let filas = conexion.execute(
        "DELETE FROM notificacion WHERE id = ?1 AND estado = 'vista'",
        [id],
    )?;

    if filas == 0 {
        return Err(Error::NoExiste);
    }

    Ok(())
}

/// Una fila de notificación entera, para poder devolverla al deshacer.
///
/// `Notificacion` no sirve: no lleva `evento_id`, porque siempre se lee dentro
/// del evento al que pertenece y ahí sobra. Devolver una fila borrada sí lo
/// necesita, y agregárselo a aquel tipo obligaría a tocar todo lo que lo
/// construye para un campo que solo usa el historial.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fila {
    pub id: i64,
    pub evento_id: i64,
    pub ocurrencia: String,
    pub momento: String,
    pub estado: String,
}

/// La fila tal como está, antes de borrarla.
pub fn capturar(conexion: &Connection, id: i64) -> Result<Fila, Error> {
    conexion
        .query_row(
            "SELECT id, evento_id, ocurrencia, momento, estado
             FROM notificacion WHERE id = ?1",
            [id],
            |f| {
                Ok(Fila {
                    id: f.get("id")?,
                    evento_id: f.get("evento_id")?,
                    ocurrencia: f.get("ocurrencia")?,
                    momento: f.get("momento")?,
                    estado: f.get("estado")?,
                })
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Error::NoExiste,
            otro => Error::Sqlite(otro),
        })
}

/// Vuelve a poner una fila capturada, con su identificador original.
///
/// Conserva el identificador a propósito, al revés que los adjuntos: la clave de
/// unicidad de la tabla impide que existan dos avisos del mismo evento a la misma
/// hora, así que devolver el mismo aviso no puede chocar con otro.
pub fn devolver(conexion: &Connection, fila: &Fila) -> Result<(), Error> {
    conexion.execute(
        "INSERT INTO notificacion (id, evento_id, ocurrencia, momento, estado)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            fila.id,
            fila.evento_id,
            fila.ocurrencia,
            fila.momento,
            fila.estado
        ],
    )?;

    Ok(())
}

/// Borra todas las vistas y devuelve cuántas eran.
pub fn borrar_vistas(conexion: &Connection) -> Result<usize, Error> {
    Ok(conexion.execute("DELETE FROM notificacion WHERE estado = 'vista'", [])?)
}

/// El tipo de hora de un evento, para saber si hace falta la zona.
///
/// Está acá y no en `hora` porque es la generación la que decide si vale la pena
/// preguntarle al sistema en qué zona está.
pub fn alguno_es_adaptable(conexion: &Connection) -> Result<bool, Error> {
    // `Cuando` vive en tres columnas, no en una: adaptable es el caso en que ni
    // ocupa el día entero ni tiene la hora clavada.
    let cuantos: i64 = conexion.query_row(
        "SELECT COUNT(*) FROM evento
         WHERE recordatorio_min IS NOT NULL AND todo_el_dia = 0 AND hora_fija = 0",
        [],
        |f| f.get(0),
    )?;

    Ok(cuantos > 0)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db;
    use crate::evento;
    use crate::grupo;
    use crate::modelo::{Cuando, EventoNuevo};

    fn momento(texto: &str) -> NaiveDateTime {
        NaiveDateTime::parse_from_str(texto, FORMATO).unwrap()
    }

    fn santiago() -> Tz {
        "America/Santiago".parse().unwrap()
    }

    fn marca(conexion: &Connection, texto: &str) {
        conexion
            .execute(
                "UPDATE ajuste SET valor = ?1 WHERE clave = 'generado_hasta'",
                [texto],
            )
            .unwrap();
    }

    fn crear(conexion: &Connection, inicio: &str, recordatorio: Option<i64>) -> i64 {
        let grupo_id = grupo::listar(conexion).unwrap()[0].id;

        evento::crear(
            conexion,
            EventoNuevo {
                grupo_id,
                titulo: "Entrega".to_string(),
                inicio: momento(inicio),
                fin: None,
                cuando: Cuando::Fija,
                importancia: Importancia::Comun,
                color: None,
                descripcion: None,
                ubicacion: None,
                url: None,
                imagen: None,
                rrule: None,
                recordatorio_min: recordatorio,
                adjuntos: Vec::new(),
            uid: None,
            },
        )
        .unwrap()
        .0
    }

    /// Pasa un evento a hora adaptable, escrita en Santiago.
    fn adaptable(conexion: &Connection, id: i64) {
        conexion
            .execute(
                "UPDATE evento
                 SET todo_el_dia = 0, hora_fija = 0, zona_origen = 'America/Santiago'
                 WHERE id = ?1",
                [id],
            )
            .unwrap();
    }

    fn con_regla(conexion: &Connection, inicio: &str, rrule: &str, recordatorio: i64) -> i64 {
        let id = crear(conexion, inicio, Some(recordatorio));
        conexion
            .execute("UPDATE evento SET rrule = ?1 WHERE id = ?2", params![rrule, id])
            .unwrap();
        id
    }

    /// Lo esperable: un aviso que cae dentro de la ventana se crea una vez.
    #[test]
    fn genera_el_aviso_de_un_evento_suelto() {
        let c = db::en_memoria();
        crear(&c, "2026-08-27 10:00", Some(30));
        marca(&c, "2026-08-27 09:00");

        let creadas = generar(&c, momento("2026-08-27 09:45"), santiago()).unwrap();

        assert_eq!(creadas, 1);
        assert_eq!(pendientes(&c).unwrap(), 1);
        assert_eq!(listar(&c).unwrap()[0].momento, momento("2026-08-27 09:30"));
    }

    /// La segunda pasada no repite lo de la primera.
    #[test]
    fn dos_pasadas_no_duplican() {
        let c = db::en_memoria();
        crear(&c, "2026-08-27 10:00", Some(30));
        marca(&c, "2026-08-27 09:00");

        generar(&c, momento("2026-08-27 09:45"), santiago()).unwrap();
        let segunda = generar(&c, momento("2026-08-27 09:50"), santiago()).unwrap();

        assert_eq!(segunda, 0);
        assert_eq!(pendientes(&c).unwrap(), 1);
    }

    /// Un aviso que todavía no llega no se adelanta.
    #[test]
    fn no_genera_avisos_futuros() {
        let c = db::en_memoria();
        crear(&c, "2026-08-27 10:00", Some(30));
        marca(&c, "2026-08-27 09:00");

        let creadas = generar(&c, momento("2026-08-27 09:20"), santiago()).unwrap();

        assert_eq!(creadas, 0);
    }

    /// Un evento sin recordatorio no produce nada.
    #[test]
    fn sin_recordatorio_no_hay_aviso() {
        let c = db::en_memoria();
        crear(&c, "2026-08-27 10:00", None);
        marca(&c, "2026-08-27 09:00");

        assert_eq!(generar(&c, momento("2026-08-27 11:00"), santiago()).unwrap(), 0);
    }

    /// La app estuvo apagada tres días: la misma pasada recupera los tres.
    #[test]
    fn recupera_lo_que_paso_con_la_app_cerrada() {
        let c = db::en_memoria();
        con_regla(&c, "2026-08-24 10:00", "FREQ=DAILY", 30);
        marca(&c, "2026-08-24 08:00");

        let creadas = generar(&c, momento("2026-08-27 12:00"), santiago()).unwrap();

        assert_eq!(creadas, 4, "del 24 al 27, uno por día");
        assert_eq!(pendientes(&c).unwrap(), 4);
    }

    /// Un recordatorio de una semana avisa siete días antes, cruzando el margen.
    #[test]
    fn un_recordatorio_largo_avisa_con_su_anticipacion() {
        let c = db::en_memoria();
        crear(&c, "2026-09-03 10:00", Some(60 * 24 * 7));
        marca(&c, "2026-08-27 09:00");

        let creadas = generar(&c, momento("2026-08-27 11:00"), santiago()).unwrap();

        assert_eq!(creadas, 1);
        assert_eq!(listar(&c).unwrap()[0].momento, momento("2026-08-27 10:00"));
    }

    /// Una ocurrencia excluida de la serie tampoco avisa.
    #[test]
    fn una_ocurrencia_borrada_no_avisa() {
        let c = db::en_memoria();
        let id = con_regla(&c, "2026-08-24 10:00", "FREQ=DAILY", 30);

        c.execute(
            "INSERT INTO excepcion (evento_id, fecha_original, override_id)
             VALUES (?1, '2026-08-26 10:00', NULL)",
            [id],
        )
        .unwrap();

        marca(&c, "2026-08-24 08:00");
        let creadas = generar(&c, momento("2026-08-27 12:00"), santiago()).unwrap();

        assert_eq!(creadas, 3, "el 26 está excluido");
    }

    /// El reloj se atrasó: la marca avanza y no se genera nada hacia atrás.
    #[test]
    fn un_reloj_atrasado_no_genera_hacia_atras() {
        let c = db::en_memoria();
        crear(&c, "2026-08-27 10:00", Some(30));
        marca(&c, "2026-08-27 12:00");

        let creadas = generar(&c, momento("2026-08-27 09:45"), santiago()).unwrap();

        assert_eq!(creadas, 0);
    }

    /// Un evento adaptable avisa según la hora que muestra en la zona de ahora.
    #[test]
    fn un_evento_adaptable_avisa_en_la_hora_local() {
        let c = db::en_memoria();
        let id = crear(&c, "2026-08-27 10:00", Some(0));
        adaptable(&c, id);

        // Madrid va cinco o seis horas por delante de Santiago según la fecha, así
        // que las 10:00 de Santiago se ven pasado el mediodía allá.
        let madrid: Tz = "Europe/Madrid".parse().unwrap();
        marca(&c, "2026-08-27 00:00");

        generar(&c, momento("2026-08-27 23:00"), madrid).unwrap();

        let aviso = &listar(&c).unwrap()[0];
        assert_ne!(
            aviso.momento,
            momento("2026-08-27 10:00"),
            "no avisa a la hora de origen"
        );
        assert_eq!(aviso.ocurrencia, momento("2026-08-27 10:00"));
    }

    /// Marcar una vista la baja al historial sin borrarla.
    #[test]
    fn marcar_vista_no_borra() {
        let c = db::en_memoria();
        crear(&c, "2026-08-27 10:00", Some(30));
        marca(&c, "2026-08-27 09:00");
        generar(&c, momento("2026-08-27 09:45"), santiago()).unwrap();

        let id = listar(&c).unwrap()[0].id;
        marcar_vista(&c, id).unwrap();

        assert_eq!(pendientes(&c).unwrap(), 0);
        assert_eq!(listar(&c).unwrap().len(), 1);
        assert!(listar(&c).unwrap()[0].vista);
    }

    /// Las pendientes van arriba, aunque sean más antiguas que una vista.
    #[test]
    fn las_pendientes_van_primero() {
        let c = db::en_memoria();
        con_regla(&c, "2026-08-24 10:00", "FREQ=DAILY", 30);
        marca(&c, "2026-08-24 08:00");
        generar(&c, momento("2026-08-27 12:00"), santiago()).unwrap();

        // La más reciente se marca vista: tiene que bajar igual.
        let avisos = listar(&c).unwrap();
        marcar_vista(&c, avisos[0].id).unwrap();

        let despues = listar(&c).unwrap();
        assert!(!despues[0].vista);
        assert!(despues[3].vista);
    }

    /// Marcar todas devuelve cuántas eran y deja el historial completo.
    #[test]
    fn marcar_todas_vacia_las_pendientes() {
        let c = db::en_memoria();
        con_regla(&c, "2026-08-24 10:00", "FREQ=DAILY", 30);
        marca(&c, "2026-08-24 08:00");
        generar(&c, momento("2026-08-27 12:00"), santiago()).unwrap();

        assert_eq!(marcar_todas_vistas(&c).unwrap(), 4);
        assert_eq!(pendientes(&c).unwrap(), 0);
        assert_eq!(listar(&c).unwrap().len(), 4);
    }

    /// Borrar el evento se lleva sus notificaciones.
    #[test]
    fn borrar_el_evento_borra_sus_avisos() {
        let c = db::en_memoria();
        let id = crear(&c, "2026-08-27 10:00", Some(30));
        marca(&c, "2026-08-27 09:00");
        generar(&c, momento("2026-08-27 09:45"), santiago()).unwrap();

        evento::borrar(&c, id).unwrap();

        assert_eq!(pendientes(&c).unwrap(), 0);
        assert!(listar(&c).unwrap().is_empty());
    }

    /// La marca de la semilla se puede leer: es la deuda que cerró la 003.
    #[test]
    fn la_marca_de_la_semilla_es_legible() {
        let c = db::en_memoria();

        let leida = leer_marca(&c).unwrap();

        assert_eq!(leida.format(FORMATO).to_string().len(), 16);
    }

    /// El margen crece con el recordatorio en vez de ser un número fijo.
    #[test]
    fn el_margen_cubre_recordatorios_largos() {
        assert_eq!(dias_de_margen(30), 2);
        assert_eq!(dias_de_margen(60 * 24), 3);
        assert_eq!(dias_de_margen(60 * 24 * 7), 9);
    }

    /// La zona solo hace falta si hay algún evento adaptable con recordatorio.
    #[test]
    fn sabe_cuando_la_zona_importa() {
        let c = db::en_memoria();
        let id = crear(&c, "2026-08-27 10:00", Some(30));
        assert!(!alguno_es_adaptable(&c).unwrap());

        adaptable(&c, id);

        assert!(alguno_es_adaptable(&c).unwrap());
    }

    /// Una fecha que no existe por el cambio de horario no rompe la generación.
    #[test]
    fn el_cambio_de_horario_no_rompe_la_generacion() {
        let c = db::en_memoria();
        // En Santiago el reloj salta hacia adelante en septiembre.
        con_regla(&c, "2026-09-05 00:30", "FREQ=DAILY", 30);
        marca(&c, "2026-09-05 00:00");

        let creadas = generar(&c, momento("2026-09-09 12:00"), santiago()).unwrap();

        assert!(creadas >= 4, "generó los días del tramo: {creadas}");
    }

    /// Borrar una vista la quita de la lista para siempre.
    #[test]
    fn borrar_una_vista_la_saca() {
        let c = db::en_memoria();
        crear(&c, "2026-08-27 10:00", Some(30));
        marca(&c, "2026-08-27 09:00");
        generar(&c, momento("2026-08-27 09:45"), santiago()).unwrap();

        let id = listar(&c).unwrap()[0].id;
        marcar_vista(&c, id).unwrap();
        borrar(&c, id).unwrap();

        assert!(listar(&c).unwrap().is_empty());
    }

    /// Una pendiente no se puede borrar: primero hay que verla.
    #[test]
    fn una_pendiente_no_se_borra() {
        let c = db::en_memoria();
        crear(&c, "2026-08-27 10:00", Some(30));
        marca(&c, "2026-08-27 09:00");
        generar(&c, momento("2026-08-27 09:45"), santiago()).unwrap();

        let id = listar(&c).unwrap()[0].id;

        assert!(matches!(borrar(&c, id), Err(Error::NoExiste)));
        assert_eq!(pendientes(&c).unwrap(), 1);
    }

    /// Borrar las vistas deja intactas las pendientes.
    #[test]
    fn borrar_las_vistas_no_toca_las_pendientes() {
        let c = db::en_memoria();
        con_regla(&c, "2026-08-24 10:00", "FREQ=DAILY", 30);
        marca(&c, "2026-08-24 08:00");
        generar(&c, momento("2026-08-27 12:00"), santiago()).unwrap();

        let avisos = listar(&c).unwrap();
        marcar_vista(&c, avisos[0].id).unwrap();
        marcar_vista(&c, avisos[1].id).unwrap();

        assert_eq!(borrar_vistas(&c).unwrap(), 2);
        assert_eq!(listar(&c).unwrap().len(), 2);
        assert_eq!(pendientes(&c).unwrap(), 2);
    }

    /// Volver a generar no resucita una borrada: su ventana ya pasó.
    #[test]
    fn una_borrada_no_vuelve_en_la_siguiente_pasada() {
        let c = db::en_memoria();
        crear(&c, "2026-08-27 10:00", Some(30));
        marca(&c, "2026-08-27 09:00");
        generar(&c, momento("2026-08-27 09:45"), santiago()).unwrap();

        let id = listar(&c).unwrap()[0].id;
        marcar_vista(&c, id).unwrap();
        borrar(&c, id).unwrap();

        generar(&c, momento("2026-08-27 10:30"), santiago()).unwrap();

        assert!(listar(&c).unwrap().is_empty());
    }

    /// Marcar una que no existe falla en vez de callar.
    #[test]
    fn marcar_una_inexistente_falla() {
        let c = db::en_memoria();

        assert!(matches!(marcar_vista(&c, 999), Err(Error::NoExiste)));
    }
}
