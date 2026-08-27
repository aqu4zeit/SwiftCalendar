//! Operaciones sobre eventos.

use chrono::{Local, NaiveDate, NaiveDateTime};
use chrono_tz::Tz;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::historial::Accion;
use crate::modelo::{
    Adjunto, Cuando, Error, Evento, EventoCompleto, EventoNuevo, Excepcion, Imagen, Importancia,
    Notificacion, FORMATO,
};

fn texto(fecha: NaiveDateTime) -> String {
    fecha.format(FORMATO).to_string()
}

fn fecha(texto: &str) -> Result<NaiveDateTime, Error> {
    NaiveDateTime::parse_from_str(texto, FORMATO)
        .map_err(|_| Error::DatoCorrupto(format!("fecha '{texto}'")))
}

fn ahora() -> NaiveDateTime {
    Local::now().naive_local()
}

/// Las tres columnas que describen el significado de la hora.
fn columnas_de_cuando(cuando: Cuando) -> (i64, i64, Option<String>) {
    match cuando {
        Cuando::TodoElDia => (1, 1, None),
        Cuando::Fija => (0, 1, None),
        Cuando::Adaptable(zona) => (0, 0, Some(zona.name().to_string())),
    }
}

/// Un evento desde una fila de `SELECT *`.
///
/// Pública porque la generación de notificaciones consulta la tabla con su
/// propio filtro y necesita leer las filas igual que el resto.
pub fn desde_fila(fila: &Row) -> Result<Evento, Error> {
    let cuando = if fila.get::<_, i64>("todo_el_dia")? == 1 {
        Cuando::TodoElDia
    } else if fila.get::<_, i64>("hora_fija")? == 1 {
        Cuando::Fija
    } else {
        let nombre: String = fila.get("zona_origen")?;
        Cuando::Adaptable(
            nombre
                .parse::<Tz>()
                .map_err(|_| Error::DatoCorrupto(format!("zona horaria '{nombre}'")))?,
        )
    };

    let imagen = match (
        fila.get::<_, Option<String>>("imagen")?,
        fila.get::<_, Option<String>>("imagen_thumb")?,
    ) {
        (Some(original), Some(miniatura)) => Some(Imagen {
            original,
            miniatura,
        }),
        _ => None,
    };

    let fin = match fila.get::<_, Option<String>>("fin")? {
        Some(t) => Some(fecha(&t)?),
        None => None,
    };

    Ok(Evento {
        id: fila.get("id")?,
        grupo_id: fila.get("grupo_id")?,
        titulo: fila.get("titulo")?,
        inicio: fecha(&fila.get::<_, String>("inicio")?)?,
        fin,
        cuando,
        importancia: Importancia::desde_texto(&fila.get::<_, String>("importancia")?)?,
        color: fila.get("color")?,
        descripcion: fila.get("descripcion")?,
        ubicacion: fila.get("ubicacion")?,
        url: fila.get("url")?,
        imagen,
        rrule: fila.get("rrule")?,
        recordatorio_min: fila.get("recordatorio_min")?,
        creado: fecha(&fila.get::<_, String>("creado")?)?,
        modificado: fecha(&fila.get::<_, String>("modificado")?)?,
    })
}

pub fn adjuntos_de(conexion: &Connection, evento_id: i64) -> Result<Vec<Adjunto>, Error> {
    let mut c = conexion.prepare("SELECT * FROM adjunto WHERE evento_id = ?1 ORDER BY id")?;
    let filas = c.query_map([evento_id], |f| {
        Ok(Adjunto {
            ruta: f.get("ruta")?,
            nombre_original: f.get("nombre_original")?,
            tamano: f.get("tamano")?,
        })
    })?;
    Ok(filas.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// El identificador lo pone la base: ninguna otra tabla apunta a un adjunto.
fn insertar_adjuntos(
    conexion: &Connection,
    evento_id: i64,
    adjuntos: &[Adjunto],
) -> Result<(), Error> {
    for a in adjuntos {
        conexion.execute(
            "INSERT INTO adjunto (evento_id, ruta, nombre_original, tamano)
             VALUES (?1, ?2, ?3, ?4)",
            params![evento_id, a.ruta, a.nombre_original, a.tamano],
        )?;
    }
    Ok(())
}

fn notificaciones_de(conexion: &Connection, evento_id: i64) -> Result<Vec<Notificacion>, Error> {
    let mut c = conexion.prepare("SELECT * FROM notificacion WHERE evento_id = ?1")?;
    let filas = c.query_map([evento_id], |f| {
        Ok(Notificacion {
            id: f.get("id")?,
            ocurrencia: f.get("ocurrencia")?,
            momento: f.get("momento")?,
            estado: f.get("estado")?,
        })
    })?;
    Ok(filas.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn insertar_notificaciones(
    conexion: &Connection,
    evento_id: i64,
    notificaciones: &[Notificacion],
) -> Result<(), Error> {
    for n in notificaciones {
        conexion.execute(
            "INSERT INTO notificacion (id, evento_id, ocurrencia, momento, estado)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![n.id, evento_id, n.ocurrencia, n.momento, n.estado],
        )?;
    }
    Ok(())
}

/// Los cuatro campos que determinan cuándo suena un recordatorio.
fn cambio_el_horario(antes: &Evento, despues: &Evento) -> bool {
    antes.inicio != despues.inicio
        || antes.cuando != despues.cuando
        || antes.rrule != despues.rrule
        || antes.recordatorio_min != despues.recordatorio_min
}

pub fn leer(conexion: &Connection, id: i64) -> Result<Evento, Error> {
    conexion
        .query_row("SELECT * FROM evento WHERE id = ?1", [id], |fila| {
            Ok(desde_fila(fila))
        })
        .optional()?
        .ok_or(Error::NoExiste)?
}

/// Los eventos que pueden producir instancias dentro de un rango de días.
///
/// Los sueltos se traen si su tramo cruza el rango. Las series se traen siempre:
/// `UNTIL` y `COUNT` viven dentro del texto de la regla y SQL no los sabe leer.
pub fn leer_en_rango(
    conexion: &Connection,
    desde: NaiveDate,
    hasta: NaiveDate,
) -> Result<Vec<Evento>, Error> {
    let primer_instante = texto(
        desde
            .and_hms_opt(0, 0, 0)
            .expect("las 00:00 existen en cualquier día"),
    );
    let ultimo_instante = texto(
        hasta
            .and_hms_opt(23, 59, 0)
            .expect("las 23:59 existen en cualquier día"),
    );

    let mut consulta = conexion.prepare(
        "SELECT * FROM evento
         WHERE rrule IS NOT NULL
            OR (inicio <= ?2 AND COALESCE(fin, inicio) >= ?1)
         ORDER BY id",
    )?;
    let filas = consulta.query_map(params![primer_instante, ultimo_instante], |f| {
        Ok(desde_fila(f))
    })?;

    filas
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .collect()
}

/// Inserta la fila y devuelve su identificador.
pub fn insertar(conexion: &Connection, nuevo: EventoNuevo) -> Result<i64, Error> {
    let (todo_el_dia, hora_fija, zona) = columnas_de_cuando(nuevo.cuando);
    let (imagen, miniatura) = match &nuevo.imagen {
        Some(i) => (Some(&i.original), Some(&i.miniatura)),
        None => (None, None),
    };
    let momento = texto(ahora());

    conexion.execute(
        "INSERT INTO evento (
            grupo_id, titulo, inicio, fin, todo_el_dia, hora_fija, zona_origen,
            importancia, color, descripcion, ubicacion, url, imagen, imagen_thumb,
            rrule, recordatorio_min, creado, modificado
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18
         )",
        params![
            nuevo.grupo_id,
            nuevo.titulo,
            texto(nuevo.inicio),
            nuevo.fin.map(texto),
            todo_el_dia,
            hora_fija,
            zona,
            nuevo.importancia.como_texto(),
            nuevo.color,
            nuevo.descripcion,
            nuevo.ubicacion,
            nuevo.url,
            imagen,
            miniatura,
            nuevo.rrule,
            nuevo.recordatorio_min,
            momento,
            momento,
        ],
    )?;

    let id = conexion.last_insert_rowid();
    insertar_adjuntos(conexion, id, &nuevo.adjuntos)?;

    Ok(id)
}

/// Crea un evento y devuelve su identificador junto con la acción.
///
/// Es la que abre la transacción: `insertar` escribe en dos tablas y no puede
/// abrirla ella, porque quien crea una ocurrencia suelta ya está dentro de una.
pub fn crear(conexion: &Connection, nuevo: EventoNuevo) -> Result<(i64, Accion), Error> {
    let tx = conexion.unchecked_transaction()?;
    let id = insertar(&tx, nuevo)?;
    tx.commit()?;

    Ok((id, Accion::EventoCreado { id }))
}

/// Escribe un evento completo y devuelve cómo estaba antes.
/// La lista de adjuntos no es opcional: la interfaz siempre declara cuál quiere
/// que quede, igual que declara la imagen. El `Option` de las notificaciones
/// existe porque esa decisión la toma Rust y tiene que poder no opinar.
pub fn escribir(
    conexion: &Connection,
    evento: &Evento,
    notificaciones: Option<&[Notificacion]>,
    adjuntos: &[Adjunto],
) -> Result<Accion, Error> {
    let antes = leer(conexion, evento.id)?;
    let tx = conexion.unchecked_transaction()?;

    let (todo_el_dia, hora_fija, zona) = columnas_de_cuando(evento.cuando);
    let (imagen, miniatura) = match &evento.imagen {
        Some(i) => (Some(&i.original), Some(&i.miniatura)),
        None => (None, None),
    };

    tx.execute(
        "UPDATE evento SET
            grupo_id = ?1, titulo = ?2, inicio = ?3, fin = ?4, todo_el_dia = ?5,
            hora_fija = ?6, zona_origen = ?7, importancia = ?8, color = ?9,
            descripcion = ?10, ubicacion = ?11, url = ?12, imagen = ?13,
            imagen_thumb = ?14, rrule = ?15, recordatorio_min = ?16, modificado = ?17
         WHERE id = ?18",
        params![
            evento.grupo_id,
            evento.titulo,
            texto(evento.inicio),
            evento.fin.map(texto),
            todo_el_dia,
            hora_fija,
            zona,
            evento.importancia.como_texto(),
            evento.color,
            evento.descripcion,
            evento.ubicacion,
            evento.url,
            imagen,
            miniatura,
            evento.rrule,
            evento.recordatorio_min,
            texto(evento.modificado),
            evento.id,
        ],
    )?;

    let capturadas = match notificaciones {
        None => None,
        Some(nuevas) => {
            let previas = notificaciones_de(&tx, evento.id)?;
            tx.execute("DELETE FROM notificacion WHERE evento_id = ?1", [evento.id])?;
            insertar_notificaciones(&tx, evento.id, nuevas)?;
            Some(previas)
        }
    };

    let adjuntos_previos = adjuntos_de(&tx, evento.id)?;
    tx.execute("DELETE FROM adjunto WHERE evento_id = ?1", [evento.id])?;
    insertar_adjuntos(&tx, evento.id, adjuntos)?;

    tx.commit()?;

    Ok(Accion::EventoEditado {
        antes,
        notificaciones: capturadas,
        adjuntos: adjuntos_previos,
    })
}

/// Edita un evento desde la interfaz.
pub fn editar(
    conexion: &Connection,
    evento: &Evento,
    adjuntos: &[Adjunto],
) -> Result<Accion, Error> {
    let antes = leer(conexion, evento.id)?;

    let mut con_marca = evento.clone();
    con_marca.modificado = ahora();

    let notificaciones = if cambio_el_horario(&antes, &con_marca) {
        Some(&[][..])
    } else {
        None
    };

    escribir(conexion, &con_marca, notificaciones, adjuntos)
}

/// Un evento con todo lo que cuelga de él. No abre transacción.
pub fn capturar(conexion: &Connection, id: i64) -> Result<EventoCompleto, Error> {
    let evento = leer(conexion, id)?;

    let adjuntos = adjuntos_de(conexion, id)?;

    let excepciones: Vec<Excepcion> = {
        let mut c = conexion.prepare("SELECT * FROM excepcion WHERE evento_id = ?1")?;
        let filas = c.query_map([id], |f| {
            Ok(Excepcion {
                fecha_original: f.get("fecha_original")?,
                override_id: f.get("override_id")?,
            })
        })?;
        filas.collect::<rusqlite::Result<Vec<_>>>()?
    };

    let notificaciones = notificaciones_de(conexion, id)?;

    Ok(EventoCompleto {
        evento,
        adjuntos,
        excepciones,
        notificaciones,
    })
}

/// Borra un evento y todo lo que cuelga de él.
pub fn borrar(conexion: &Connection, id: i64) -> Result<Accion, Error> {
    let tx = conexion.unchecked_transaction()?;
    let completo = capturar(&tx, id)?;

    tx.execute("DELETE FROM evento WHERE id = ?1", [id])?;
    tx.commit()?;

    Ok(Accion::EventoBorrado(completo))
}

/// Escribe un evento y todo lo que colgaba de él. No abre transacción.
pub fn insertar_completo(conexion: &Connection, completo: &EventoCompleto) -> Result<(), Error> {
    let evento = &completo.evento;
    let (todo_el_dia, hora_fija, zona) = columnas_de_cuando(evento.cuando);
    let (imagen, miniatura) = match &evento.imagen {
        Some(i) => (Some(&i.original), Some(&i.miniatura)),
        None => (None, None),
    };

    conexion.execute(
        "INSERT INTO evento (
            id, grupo_id, titulo, inicio, fin, todo_el_dia, hora_fija, zona_origen,
            importancia, color, descripcion, ubicacion, url, imagen, imagen_thumb,
            rrule, recordatorio_min, creado, modificado
         ) VALUES (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19
         )",
        params![
            evento.id,
            evento.grupo_id,
            evento.titulo,
            texto(evento.inicio),
            evento.fin.map(texto),
            todo_el_dia,
            hora_fija,
            zona,
            evento.importancia.como_texto(),
            evento.color,
            evento.descripcion,
            evento.ubicacion,
            evento.url,
            imagen,
            miniatura,
            evento.rrule,
            evento.recordatorio_min,
            texto(evento.creado),
            texto(evento.modificado),
        ],
    )?;

    insertar_adjuntos(conexion, evento.id, &completo.adjuntos)?;

    for e in &completo.excepciones {
        conexion.execute(
            "INSERT INTO excepcion (evento_id, fecha_original, override_id)
             VALUES (?1, ?2, ?3)",
            params![evento.id, e.fecha_original, e.override_id],
        )?;
    }

    insertar_notificaciones(conexion, evento.id, &completo.notificaciones)?;

    Ok(())
}

/// Devuelve un evento borrado con todo lo que colgaba de él.
pub fn restaurar(conexion: &Connection, completo: &EventoCompleto) -> Result<Accion, Error> {
    let tx = conexion.unchecked_transaction()?;
    insertar_completo(&tx, completo)?;
    tx.commit()?;

    Ok(Accion::EventoCreado {
        id: completo.evento.id,
    })
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db;
    use crate::grupo;
    use crate::historial::Historial;
    use chrono::NaiveDate;
    use chrono_tz::Asia::Tokyo;

    fn momento(a: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(a, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
    }

    fn grupo_defecto(conexion: &Connection) -> i64 {
        grupo::listar(conexion).unwrap()[0].id
    }

    fn minimo(grupo_id: i64) -> EventoNuevo {
        EventoNuevo {
            grupo_id,
            titulo: "Entrega informe HPC".to_string(),
            inicio: momento(2026, 8, 12, 18, 0),
            fin: Some(momento(2026, 8, 12, 20, 0)),
            cuando: Cuando::Fija,
            importancia: Importancia::Urgente,
            color: None,
            descripcion: None,
            ubicacion: None,
            url: None,
            imagen: None,
            rrule: None,
            recordatorio_min: Some(30),
            adjuntos: Vec::new(),
        }
    }

    #[test]
    fn crear_y_leer_conserva_todos_los_campos() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let id = crear(&c, minimo(g)).unwrap().0;
        let leido = leer(&c, id).unwrap();

        assert_eq!(leido.titulo, "Entrega informe HPC");
        assert_eq!(leido.inicio, momento(2026, 8, 12, 18, 0));
        assert_eq!(leido.fin, Some(momento(2026, 8, 12, 20, 0)));
        assert_eq!(leido.cuando, Cuando::Fija);
        assert_eq!(leido.importancia, Importancia::Urgente);
        assert_eq!(leido.recordatorio_min, Some(30));
    }

    /// Las tres formas de `Cuando` sobreviven la ida y vuelta a la base.
    #[test]
    fn los_tres_tipos_de_hora_sobreviven_la_ida_y_vuelta() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        for cuando in [Cuando::Fija, Cuando::TodoElDia, Cuando::Adaptable(Tokyo)] {
            let mut nuevo = minimo(g);
            nuevo.cuando = cuando;
            let id = crear(&c, nuevo).unwrap().0;

            assert_eq!(leer(&c, id).unwrap().cuando, cuando);
        }
    }

    /// Un evento de todo el día de tres días es una sola fila con inicio y fin.
    #[test]
    fn un_todo_el_dia_de_tres_dias_es_una_sola_fila() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut nuevo = minimo(g);
        nuevo.titulo = "Visita a los abuelos".to_string();
        nuevo.cuando = Cuando::TodoElDia;
        nuevo.inicio = momento(2026, 8, 7, 0, 0);
        nuevo.fin = Some(momento(2026, 8, 9, 0, 0));

        let id = crear(&c, nuevo).unwrap().0;
        let leido = leer(&c, id).unwrap();

        assert_eq!(leido.inicio.date(), momento(2026, 8, 7, 0, 0).date());
        assert_eq!(leido.fin.unwrap().date(), momento(2026, 8, 9, 0, 0).date());
    }

    #[test]
    fn editar_se_deshace_y_se_rehace() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let g = grupo_defecto(&c);

        let id = crear(&c, minimo(g)).unwrap().0;

        let mut cambiado = leer(&c, id).unwrap();
        cambiado.titulo = "Entrega postergada".to_string();
        cambiado.importancia = Importancia::Comun;
        h.registrar(editar(&c, &cambiado, &[]).unwrap());

        h.deshacer(&c).unwrap();
        let vuelto = leer(&c, id).unwrap();
        assert_eq!(vuelto.titulo, "Entrega informe HPC");
        assert_eq!(vuelto.importancia, Importancia::Urgente);

        h.rehacer(&c).unwrap();
        assert_eq!(leer(&c, id).unwrap().titulo, "Entrega postergada");
    }

    /// Deshacer un borrado devuelve la fila idéntica, con el mismo id.
    #[test]
    fn deshacer_un_borrado_devuelve_el_evento_identico() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let g = grupo_defecto(&c);

        let id = crear(&c, minimo(g)).unwrap().0;
        let antes = leer(&c, id).unwrap();

        h.registrar(borrar(&c, id).unwrap());
        assert!(matches!(leer(&c, id), Err(Error::NoExiste)));

        h.deshacer(&c).unwrap();
        assert_eq!(leer(&c, id).unwrap(), antes);
    }

    /// Borrar el maestro de una serie se lleva sus excepciones por cascada.
    #[test]
    fn deshacer_un_borrado_devuelve_las_excepciones() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let g = grupo_defecto(&c);

        let mut serie = minimo(g);
        serie.rrule = Some("FREQ=WEEKLY;BYDAY=MO".to_string());
        let id = crear(&c, serie).unwrap().0;

        c.execute(
            "INSERT INTO excepcion (evento_id, fecha_original, override_id)
             VALUES (?1, '2026-08-17 18:00', NULL)",
            [id],
        )
        .unwrap();

        h.registrar(borrar(&c, id).unwrap());

        let cuantas = |conexion: &Connection| -> i64 {
            conexion
                .query_row("SELECT COUNT(*) FROM excepcion", [], |f| f.get(0))
                .unwrap()
        };
        assert_eq!(cuantas(&c), 0, "la cascada se las lleva");

        h.deshacer(&c).unwrap();
        assert_eq!(cuantas(&c), 1, "deshacer las devuelve");
    }

    /// Lo mismo con adjuntos y notificaciones, que cuelgan del mismo evento.
    #[test]
    fn deshacer_un_borrado_devuelve_adjuntos_y_notificaciones() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let g = grupo_defecto(&c);

        let id = crear(&c, minimo(g)).unwrap().0;

        c.execute(
            "INSERT INTO adjunto (evento_id, ruta, nombre_original, tamano)
             VALUES (?1, 'assets/adjuntos/r.pdf', 'rubrica.pdf', 245760)",
            [id],
        )
        .unwrap();
        c.execute(
            "INSERT INTO notificacion (evento_id, ocurrencia, momento, estado)
             VALUES (?1, '2026-08-12 18:00', '2026-08-12 17:30', 'vista')",
            [id],
        )
        .unwrap();

        h.registrar(borrar(&c, id).unwrap());
        h.deshacer(&c).unwrap();

        let adjunto: String = c
            .query_row("SELECT nombre_original FROM adjunto", [], |f| f.get(0))
            .unwrap();
        let estado: String = c
            .query_row("SELECT estado FROM notificacion", [], |f| f.get(0))
            .unwrap();

        assert_eq!(adjunto, "rubrica.pdf");
        assert_eq!(estado, "vista", "el estado visto no se pierde al deshacer");
    }

    fn adjunto(nombre: &str) -> Adjunto {
        Adjunto {
            ruta: format!("assets/adjuntos/{nombre}"),
            nombre_original: nombre.to_string(),
            tamano: 1024,
        }
    }

    fn adjuntos_guardados(conexion: &Connection, evento_id: i64) -> Vec<String> {
        adjuntos_de(conexion, evento_id)
            .unwrap()
            .into_iter()
            .map(|a| a.nombre_original)
            .collect()
    }

    /// Los adjuntos entran junto con la fila, en la misma escritura.
    #[test]
    fn crear_un_evento_guarda_sus_adjuntos() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut nuevo = minimo(g);
        nuevo.adjuntos = vec![adjunto("rubrica.pdf"), adjunto("planilla.xlsx")];
        let id = crear(&c, nuevo).unwrap().0;

        assert_eq!(adjuntos_guardados(&c, id), ["rubrica.pdf", "planilla.xlsx"]);
    }

    /// Editar declara la lista completa: lo que no viene, se va.
    #[test]
    fn editar_reemplaza_la_lista_entera() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut nuevo = minimo(g);
        nuevo.adjuntos = vec![adjunto("vieja.pdf"), adjunto("otra.pdf")];
        let id = crear(&c, nuevo).unwrap().0;

        let evento = leer(&c, id).unwrap();
        editar(&c, &evento, &[adjunto("nueva.pdf")]).unwrap();

        assert_eq!(adjuntos_guardados(&c, id), ["nueva.pdf"]);
    }

    /// Deshacer una edición devuelve los adjuntos que había antes.
    #[test]
    fn deshacer_una_edicion_devuelve_los_adjuntos() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let g = grupo_defecto(&c);

        let mut nuevo = minimo(g);
        nuevo.adjuntos = vec![adjunto("rubrica.pdf")];
        let id = crear(&c, nuevo).unwrap().0;

        let mut cambiado = leer(&c, id).unwrap();
        cambiado.titulo = "Otro título".to_string();
        h.registrar(editar(&c, &cambiado, &[]).unwrap());
        assert!(adjuntos_guardados(&c, id).is_empty());

        h.deshacer(&c).unwrap();
        assert_eq!(adjuntos_guardados(&c, id), ["rubrica.pdf"]);

        h.rehacer(&c).unwrap();
        assert!(adjuntos_guardados(&c, id).is_empty(), "rehacer los vuelve a sacar");
    }

    /// Restaurar no conserva identificadores: nada apunta a un adjunto.
    #[test]
    fn los_adjuntos_restaurados_reciben_identificador_nuevo() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let g = grupo_defecto(&c);

        let mut nuevo = minimo(g);
        nuevo.adjuntos = vec![adjunto("rubrica.pdf")];
        let id = crear(&c, nuevo).unwrap().0;

        h.registrar(borrar(&c, id).unwrap());
        h.deshacer(&c).unwrap();

        assert_eq!(adjuntos_guardados(&c, id), ["rubrica.pdf"]);
    }

    fn notificar(conexion: &Connection, evento_id: i64, ocurrencia: &str) {
        conexion
            .execute(
                "INSERT INTO notificacion (evento_id, ocurrencia, momento, estado)
                 VALUES (?1, ?2, '2026-08-12 17:30', 'pendiente')",
                params![evento_id, ocurrencia],
            )
            .unwrap();
    }

    fn cuantas_notificaciones(conexion: &Connection) -> i64 {
        conexion
            .query_row("SELECT COUNT(*) FROM notificacion", [], |f| f.get(0))
            .unwrap()
    }

    /// Mover la hora de un evento borra sus notificaciones.
    #[test]
    fn mover_la_hora_borra_las_notificaciones() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let id = crear(&c, minimo(g)).unwrap().0;
        notificar(&c, id, "2026-08-12 18:00");

        // Mover un evento mueve sus dos extremos.
        let mut movido = leer(&c, id).unwrap();
        movido.inicio = momento(2026, 8, 14, 18, 0);
        movido.fin = Some(momento(2026, 8, 14, 20, 0));
        editar(&c, &movido, &[]).unwrap();

        assert_eq!(cuantas_notificaciones(&c), 0);
    }

    /// Cambiar los minutos de aviso también mueve la hora del recordatorio.
    #[test]
    fn cambiar_el_recordatorio_borra_las_notificaciones() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let id = crear(&c, minimo(g)).unwrap().0;
        notificar(&c, id, "2026-08-12 18:00");

        let mut cambiado = leer(&c, id).unwrap();
        cambiado.recordatorio_min = Some(120);
        editar(&c, &cambiado, &[]).unwrap();

        assert_eq!(cuantas_notificaciones(&c), 0);
    }

    /// Cambiar el título no toca las notificaciones.
    #[test]
    fn cambiar_solo_el_titulo_conserva_las_notificaciones() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let id = crear(&c, minimo(g)).unwrap().0;
        notificar(&c, id, "2026-08-12 18:00");

        let mut cambiado = leer(&c, id).unwrap();
        cambiado.titulo = "Entrega informe HPC (final)".to_string();
        cambiado.descripcion = Some("Subir el PDF".to_string());
        editar(&c, &cambiado, &[]).unwrap();

        assert_eq!(cuantas_notificaciones(&c), 1);
    }

    /// Deshacer devuelve el horario viejo y, con él, sus avisos.
    #[test]
    fn deshacer_un_cambio_de_hora_devuelve_las_notificaciones() {
        let c = db::en_memoria();
        let mut h = Historial::default();
        let g = grupo_defecto(&c);

        let id = crear(&c, minimo(g)).unwrap().0;
        notificar(&c, id, "2026-08-12 18:00");

        let mut movido = leer(&c, id).unwrap();
        movido.inicio = momento(2026, 8, 14, 18, 0);
        movido.fin = Some(momento(2026, 8, 14, 20, 0));
        h.registrar(editar(&c, &movido, &[]).unwrap());
        assert_eq!(cuantas_notificaciones(&c), 0);

        h.deshacer(&c).unwrap();
        assert_eq!(leer(&c, id).unwrap().inicio, momento(2026, 8, 12, 18, 0));
        assert_eq!(cuantas_notificaciones(&c), 1, "el aviso vuelve con la hora");

        h.rehacer(&c).unwrap();
        assert_eq!(cuantas_notificaciones(&c), 0, "y se va de nuevo al rehacer");
    }

    /// Las restricciones del esquema llegan como error, no como fila escrita.
    #[test]
    fn el_esquema_rechaza_un_titulo_vacio() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut nuevo = minimo(g);
        nuevo.titulo = "   ".to_string();

        assert!(matches!(crear(&c, nuevo), Err(Error::Sqlite(_))));
    }

    #[test]
    fn el_esquema_rechaza_un_fin_anterior_al_inicio() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut nuevo = minimo(g);
        nuevo.fin = Some(momento(2026, 8, 12, 17, 0));

        assert!(matches!(crear(&c, nuevo), Err(Error::Sqlite(_))));
    }
}
