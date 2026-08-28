//! Motor de recurrencia y excepciones.

use std::collections::HashSet;

use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};
use rusqlite::Connection;

use crate::modelo::{Error, Evento, FORMATO};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frecuencia {
    Diaria,
    Semanal,
    Mensual,
    Anual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Final {
    Nunca,
    /// Incluye ese día.
    Hasta(NaiveDate),
    Veces(u32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Regla {
    pub frecuencia: Frecuencia,
    pub intervalo: u32,
    pub final_: Final,
}

impl Regla {
    pub fn parsear(texto: &str) -> Result<Regla, Error> {
        let mal = |que: &str| Error::ReglaInvalida(format!("{que} en '{texto}'"));

        let mut frecuencia = None;
        let mut intervalo = 1u32;
        let mut hasta = None;
        let mut veces = None;

        for parte in texto.split(';').filter(|p| !p.is_empty()) {
            let (clave, valor) = parte
                .split_once('=')
                .ok_or_else(|| mal(&format!("'{parte}' no tiene la forma CLAVE=VALOR")))?;

            match clave.trim().to_uppercase().as_str() {
                "FREQ" => {
                    frecuencia = Some(match valor.trim().to_uppercase().as_str() {
                        "DAILY" => Frecuencia::Diaria,
                        "WEEKLY" => Frecuencia::Semanal,
                        "MONTHLY" => Frecuencia::Mensual,
                        "YEARLY" => Frecuencia::Anual,
                        otra => return Err(mal(&format!("frecuencia '{otra}' no soportada"))),
                    })
                }
                "INTERVAL" => {
                    intervalo = valor
                        .trim()
                        .parse()
                        .map_err(|_| mal(&format!("intervalo '{valor}' no es un número")))?;
                    if intervalo == 0 {
                        return Err(mal("el intervalo no puede ser cero"));
                    }
                }
                "UNTIL" => {
                    hasta = Some(
                        NaiveDate::parse_from_str(valor.trim(), "%Y%m%d")
                            .map_err(|_| mal(&format!("'{valor}' no tiene la forma AAAAMMDD")))?,
                    )
                }
                "COUNT" => {
                    let n: u32 = valor
                        .trim()
                        .parse()
                        .map_err(|_| mal(&format!("cantidad '{valor}' no es un número")))?;
                    if n == 0 {
                        return Err(mal("la cantidad no puede ser cero"));
                    }
                    veces = Some(n);
                }
                otra => return Err(mal(&format!("'{otra}' no está soportado"))),
            }
        }

        let final_ = match (hasta, veces) {
            (None, None) => Final::Nunca,
            (Some(f), None) => Final::Hasta(f),
            (None, Some(n)) => Final::Veces(n),
            (Some(_), Some(_)) => return Err(mal("UNTIL y COUNT no pueden ir juntos")),
        };

        Ok(Regla {
            frecuencia: frecuencia.ok_or_else(|| mal("falta FREQ"))?,
            intervalo,
            final_,
        })
    }
}

/// El periodo n-ésimo de la serie, como año, mes y día pedido.
fn periodo(inicio: NaiveDate, regla: &Regla, n: u32) -> Option<(i32, u32, u32)> {
    let salto = regla.intervalo.checked_mul(n)?;

    match regla.frecuencia {
        Frecuencia::Diaria | Frecuencia::Semanal => {
            let dias = if regla.frecuencia == Frecuencia::Semanal {
                salto.checked_mul(7)?
            } else {
                salto
            };
            let fecha = inicio.checked_add_signed(Duration::days(dias as i64))?;
            Some((fecha.year(), fecha.month(), fecha.day()))
        }
        Frecuencia::Mensual => {
            let corridos = (inicio.month0() as u32).checked_add(salto)?;
            let anio = inicio.year().checked_add((corridos / 12) as i32)?;
            Some((anio, corridos % 12 + 1, inicio.day()))
        }
        Frecuencia::Anual => {
            let anio = inicio.year().checked_add(salto as i32)?;
            Some((anio, inicio.month(), inicio.day()))
        }
    }
}

/// Recorre las ocurrencias de una serie en orden, desde la primera.
///
/// Es el recorrido puro, sin rango de fechas: se corta solo donde la regla
/// declara su final, o donde se acaba el calendario que la biblioteca sabe
/// representar. Una serie sin final es un iterador infinito, así que quien lo
/// consuma tiene que declarar dónde para.
///
/// Existe para que la expansión por rango y la búsqueda de la próxima ocurrencia
/// compartan el recorrido en vez de escribirlo cada una: la aritmética de los
/// periodos y los dos finales de la regla viven acá y en ningún otro sitio.
fn recorrer<'a>(
    inicio: NaiveDateTime,
    regla: &'a Regla,
) -> impl Iterator<Item = NaiveDateTime> + 'a {
    let mut n = 0u32;
    let mut emitidas = 0u32;
    let mut terminada = false;

    std::iter::from_fn(move || {
        loop {
            if terminada {
                return None;
            }

            let (anio, mes, dia) = periodo(inicio.date(), regla, n)?;
            n = n.checked_add(1)?;

            // El primer día del periodo avanza siempre, exista o no el día
            // pedido. Que no se pueda ni nombrar significa que el calendario se
            // acabó, y ahí la serie termina aunque la regla no lo diga.
            NaiveDate::from_ymd_opt(anio, mes, 1)?;

            // El día pedido puede no existir: un 31 en un mes de 30.
            let Some(fecha) = NaiveDate::from_ymd_opt(anio, mes, dia) else {
                continue;
            };

            if let Final::Hasta(limite) = regla.final_ {
                if fecha > limite {
                    return None;
                }
            }

            emitidas += 1;
            if let Final::Veces(cuantas) = regla.final_ {
                terminada = emitidas >= cuantas;
            }

            return Some(fecha.and_time(inicio.time()));
        }
    })
}

/// Expande una serie dentro de un rango de fechas, en hora de reloj.
pub fn expandir(
    inicio: NaiveDateTime,
    regla: &Regla,
    desde: NaiveDate,
    hasta: NaiveDate,
) -> Vec<NaiveDateTime> {
    recorrer(inicio, regla)
        .take_while(|f| f.date() <= hasta)
        .filter(|f| f.date() >= desde)
        .collect()
}

/// Las ocurrencias excluidas de una serie.
fn excluidas(conexion: &Connection, evento_id: i64) -> Result<HashSet<String>, Error> {
    let mut consulta =
        conexion.prepare("SELECT fecha_original FROM excepcion WHERE evento_id = ?1")?;
    let filas = consulta.query_map([evento_id], |f| f.get::<_, String>(0))?;
    Ok(filas.collect::<rusqlite::Result<HashSet<_>>>()?)
}

/// Las ocurrencias visibles de un evento dentro de un rango.
pub fn ocurrencias(
    conexion: &Connection,
    evento: &Evento,
    desde: NaiveDate,
    hasta: NaiveDate,
) -> Result<Vec<NaiveDateTime>, Error> {
    let Some(texto) = &evento.rrule else {
        // Un evento suelto ocupa su tramo completo, no solo su día de inicio.
        let ultimo = evento.fin.unwrap_or(evento.inicio).date();
        let dentro = evento.inicio.date() <= hasta && ultimo >= desde;
        return Ok(if dentro { vec![evento.inicio] } else { vec![] });
    };

    let regla = Regla::parsear(texto)?;
    let fuera = excluidas(conexion, evento.id)?;

    Ok(expandir(evento.inicio, &regla, desde, hasta)
        .into_iter()
        .filter(|f| !fuera.contains(&f.format(FORMATO).to_string()))
        .collect())
}

/// La primera ocurrencia que cae en `dia` o después. `None` si no hay ninguna.
///
/// Recorrer hasta encontrarla siempre acaba: o aparece una, o la regla declara
/// su final. Por eso nadie tiene que decir hasta dónde mirar, que con intervalos
/// de hasta 999 años sería un número inventado.
pub fn primera_desde(
    conexion: &Connection,
    evento: &Evento,
    dia: NaiveDate,
) -> Result<Option<NaiveDateTime>, Error> {
    let Some(regla) = regla_de(evento)? else {
        return Ok(suelta(evento, |f| f.date() >= dia));
    };

    let fuera = excluidas(conexion, evento.id)?;

    Ok(recorrer(evento.inicio, &regla)
        .filter(|f| !fuera.contains(&f.format(FORMATO).to_string()))
        .find(|f| f.date() >= dia))
}

/// La última ocurrencia que cae en `dia` o antes. `None` si no hay ninguna.
pub fn ultima_hasta(
    conexion: &Connection,
    evento: &Evento,
    dia: NaiveDate,
) -> Result<Option<NaiveDateTime>, Error> {
    let Some(regla) = regla_de(evento)? else {
        return Ok(suelta(evento, |f| f.date() <= dia));
    };

    let fuera = excluidas(conexion, evento.id)?;

    Ok(recorrer(evento.inicio, &regla)
        .take_while(|f| f.date() <= dia)
        .filter(|f| !fuera.contains(&f.format(FORMATO).to_string()))
        .last())
}

/// La regla del evento, o `None` si no se repite.
fn regla_de(evento: &Evento) -> Result<Option<Regla>, Error> {
    match &evento.rrule {
        None => Ok(None),
        Some(texto) => Regla::parsear(texto).map(Some),
    }
}

/// La única ocurrencia de un evento sin regla, si cumple.
fn suelta(evento: &Evento, cumple: impl Fn(NaiveDateTime) -> bool) -> Option<NaiveDateTime> {
    Some(evento.inicio).filter(|f| cumple(*f))
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn dia(a: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(a, m, d).unwrap()
    }

    fn momento(a: i32, m: u32, d: u32, h: u32) -> NaiveDateTime {
        dia(a, m, d).and_hms_opt(h, 0, 0).unwrap()
    }

    /// Expande y devuelve solo las fechas, para comparar más fácil.
    fn fechas(rrule: &str, inicio: NaiveDateTime, desde: NaiveDate, hasta: NaiveDate) -> Vec<NaiveDate> {
        let regla = Regla::parsear(rrule).unwrap();
        expandir(inicio, &regla, desde, hasta)
            .into_iter()
            .map(|f| f.date())
            .collect()
    }

    #[test]
    fn diaria_simple() {
        let r = fechas(
            "FREQ=DAILY",
            momento(2026, 8, 10, 9),
            dia(2026, 8, 10),
            dia(2026, 8, 13),
        );
        assert_eq!(
            r,
            vec![
                dia(2026, 8, 10),
                dia(2026, 8, 11),
                dia(2026, 8, 12),
                dia(2026, 8, 13)
            ]
        );
    }

    #[test]
    fn diaria_cada_tres_dias() {
        let r = fechas(
            "FREQ=DAILY;INTERVAL=3",
            momento(2026, 8, 10, 9),
            dia(2026, 8, 10),
            dia(2026, 8, 20),
        );
        assert_eq!(
            r,
            vec![
                dia(2026, 8, 10),
                dia(2026, 8, 13),
                dia(2026, 8, 16),
                dia(2026, 8, 19)
            ]
        );
    }

    #[test]
    fn semanal_cae_siempre_en_el_mismo_dia() {
        let r = fechas(
            "FREQ=WEEKLY",
            momento(2026, 8, 3, 9),
            dia(2026, 8, 1),
            dia(2026, 8, 31),
        );
        assert_eq!(
            r,
            vec![
                dia(2026, 8, 3),
                dia(2026, 8, 10),
                dia(2026, 8, 17),
                dia(2026, 8, 24),
                dia(2026, 8, 31)
            ]
        );
        assert!(r.iter().all(|f| f.weekday() == dia(2026, 8, 3).weekday()));
    }

    #[test]
    fn semanal_cada_dos_semanas() {
        let r = fechas(
            "FREQ=WEEKLY;INTERVAL=2",
            momento(2026, 8, 3, 9),
            dia(2026, 8, 1),
            dia(2026, 8, 31),
        );
        assert_eq!(r, vec![dia(2026, 8, 3), dia(2026, 8, 17), dia(2026, 8, 31)]);
    }

    #[test]
    fn mensual_conserva_el_dia() {
        let r = fechas(
            "FREQ=MONTHLY",
            momento(2026, 1, 15, 9),
            dia(2026, 1, 1),
            dia(2026, 4, 30),
        );
        assert_eq!(
            r,
            vec![
                dia(2026, 1, 15),
                dia(2026, 2, 15),
                dia(2026, 3, 15),
                dia(2026, 4, 15)
            ]
        );
    }

    /// Una serie mensual que empieza un 31 no inventa un 30 en los meses cortos:
    #[test]
    fn mensual_dia_31_se_salta_los_meses_cortos() {
        let r = fechas(
            "FREQ=MONTHLY",
            momento(2026, 1, 31, 9),
            dia(2026, 1, 1),
            dia(2026, 6, 30),
        );
        assert_eq!(
            r,
            vec![dia(2026, 1, 31), dia(2026, 3, 31), dia(2026, 5, 31)],
            "febrero, abril y junio no tienen 31"
        );
    }

    #[test]
    fn anual_29_de_febrero_solo_en_bisiestos() {
        let r = fechas(
            "FREQ=YEARLY",
            momento(2024, 2, 29, 9),
            dia(2024, 1, 1),
            dia(2032, 12, 31),
        );
        assert_eq!(r, vec![dia(2024, 2, 29), dia(2028, 2, 29), dia(2032, 2, 29)]);
    }

    /// Las ocurrencias que no existen tampoco gastan cupo de COUNT.
    #[test]
    fn count_limita_la_cantidad() {
        let r = fechas(
            "FREQ=MONTHLY;COUNT=3",
            momento(2026, 1, 31, 9),
            dia(2026, 1, 1),
            dia(2027, 12, 31),
        );
        assert_eq!(r, vec![dia(2026, 1, 31), dia(2026, 3, 31), dia(2026, 5, 31)]);
    }

    #[test]
    fn until_incluye_el_ultimo_dia() {
        let r = fechas(
            "FREQ=WEEKLY;UNTIL=20260817",
            momento(2026, 8, 3, 9),
            dia(2026, 8, 1),
            dia(2026, 12, 31),
        );
        assert_eq!(r, vec![dia(2026, 8, 3), dia(2026, 8, 10), dia(2026, 8, 17)]);
    }

    /// El rango recorta, no desplaza.
    #[test]
    fn el_rango_recorta_pero_no_desplaza() {
        let r = fechas(
            "FREQ=WEEKLY",
            momento(2024, 8, 5, 9),
            dia(2026, 8, 1),
            dia(2026, 8, 31),
        );
        assert_eq!(r.len(), 5);
        assert_eq!(r[0], dia(2026, 8, 3));
        assert!(r.iter().all(|f| f.weekday() == dia(2024, 8, 5).weekday()));
    }

    #[test]
    fn la_ocurrencia_conserva_la_hora_del_evento() {
        let regla = Regla::parsear("FREQ=DAILY").unwrap();
        let r = expandir(
            momento(2026, 8, 10, 21),
            &regla,
            dia(2026, 8, 10),
            dia(2026, 8, 11),
        );
        assert_eq!(r, vec![momento(2026, 8, 10, 21), momento(2026, 8, 11, 21)]);
    }

    use crate::db;
    use crate::evento;
    use crate::grupo;
    use crate::modelo::{Cuando, EventoNuevo, Importancia};

    fn serie_semanal(conexion: &Connection, inicio: NaiveDateTime) -> i64 {
        let grupo_id = grupo::listar(conexion).unwrap()[0].id;
        let (id, _) = evento::crear(
            conexion,
            EventoNuevo {
                grupo_id,
                titulo: "Clase de redes".to_string(),
                inicio,
                fin: None,
                cuando: Cuando::Fija,
                importancia: Importancia::Comun,
                color: None,
                descripcion: None,
                ubicacion: None,
                url: None,
                imagen: None,
                rrule: Some("FREQ=WEEKLY".to_string()),
                recordatorio_min: None,
                adjuntos: Vec::new(),
            uid: None,
            },
        )
        .unwrap();

        id
    }

    fn excluir(conexion: &Connection, evento_id: i64, fecha: &str) {
        conexion
            .execute(
                "INSERT INTO excepcion (evento_id, fecha_original, override_id)
                 VALUES (?1, ?2, NULL)",
                rusqlite::params![evento_id, fecha],
            )
            .unwrap();
    }

    #[test]
    fn una_excepcion_quita_su_ocurrencia() {
        let c = db::en_memoria();
        let id = serie_semanal(&c, momento(2026, 8, 3, 9));
        let e = evento::leer(&c, id).unwrap();

        let sin_excepciones = ocurrencias(&c, &e, dia(2026, 8, 1), dia(2026, 8, 31)).unwrap();
        assert_eq!(sin_excepciones.len(), 5);

        excluir(&c, id, "2026-08-17 09:00");

        let con_excepcion = ocurrencias(&c, &e, dia(2026, 8, 1), dia(2026, 8, 31)).unwrap();
        assert_eq!(con_excepcion.len(), 4);
        assert!(!con_excepcion.contains(&momento(2026, 8, 17, 9)));
        assert!(con_excepcion.contains(&momento(2026, 8, 24, 9)));
    }

    /// Un evento sin regla tiene exactamente una ocurrencia: la suya.
    #[test]
    fn un_evento_sin_regla_tiene_una_sola_ocurrencia() {
        let c = db::en_memoria();
        let id = serie_semanal(&c, momento(2026, 8, 3, 9));

        let mut e = evento::leer(&c, id).unwrap();
        e.rrule = None;

        let dentro = ocurrencias(&c, &e, dia(2026, 8, 1), dia(2026, 8, 31)).unwrap();
        assert_eq!(dentro, vec![momento(2026, 8, 3, 9)]);

        let fuera = ocurrencias(&c, &e, dia(2026, 9, 1), dia(2026, 9, 30)).unwrap();
        assert!(fuera.is_empty());
    }

    #[test]
    fn una_regla_sin_freq_es_error() {
        assert!(matches!(
            Regla::parsear("INTERVAL=2"),
            Err(Error::ReglaInvalida(_))
        ));
    }

    /// Lo que no está soportado falla fuerte, no se ignora.
    #[test]
    fn lo_no_soportado_falla_en_vez_de_ignorarse() {
        for regla in [
            "FREQ=WEEKLY;BYDAY=MO,WE",
            "FREQ=MONTHLY;BYSETPOS=3",
            "FREQ=HOURLY",
            "FREQ=WEEKLY;INTERVAL=0",
            "FREQ=WEEKLY;COUNT=5;UNTIL=20260901",
        ] {
            assert!(
                matches!(Regla::parsear(regla), Err(Error::ReglaInvalida(_))),
                "'{regla}' debería ser rechazada"
            );
        }
    }

    /// La serie infinita no obliga a declarar hasta dónde mirar.
    #[test]
    fn la_primera_desde_de_una_serie_sin_final() {
        let c = db::en_memoria();
        let id = serie_semanal(&c, momento(2020, 1, 6, 18));
        let evento = evento::leer(&c, id).unwrap();

        // El 6 de enero de 2020 fue lunes; el primer lunes desde el 26 de agosto
        // de 2026, que es miércoles, es el 31.
        let encontrada = primera_desde(&c, &evento, dia(2026, 8, 26)).unwrap();

        assert_eq!(encontrada, Some(momento(2026, 8, 31, 18)));
    }

    /// Si la serie ya terminó no hay ninguna por delante.
    #[test]
    fn la_primera_desde_de_una_serie_terminada_no_existe() {
        let c = db::en_memoria();
        let id = serie_semanal(&c, momento(2026, 8, 3, 18));

        c.execute(
            "UPDATE evento SET rrule = 'FREQ=WEEKLY;COUNT=3' WHERE id = ?1",
            [id],
        )
        .unwrap();
        let evento = evento::leer(&c, id).unwrap();

        // Los lunes 3, 10 y 17 de agosto.
        assert_eq!(primera_desde(&c, &evento, dia(2026, 12, 25)).unwrap(), None);
        assert_eq!(
            ultima_hasta(&c, &evento, dia(2026, 12, 25)).unwrap(),
            Some(momento(2026, 8, 17, 18))
        );
    }

    /// Una ocurrencia excluida no cuenta, ni hacia adelante ni hacia atrás.
    #[test]
    fn las_excluidas_no_cuentan() {
        let c = db::en_memoria();
        let id = serie_semanal(&c, momento(2026, 8, 3, 18));
        excluir(&c, id, "2026-08-31 18:00");
        let evento = evento::leer(&c, id).unwrap();

        assert_eq!(
            primera_desde(&c, &evento, dia(2026, 8, 26)).unwrap(),
            Some(momento(2026, 9, 7, 18))
        );
        assert_eq!(
            ultima_hasta(&c, &evento, dia(2026, 8, 31)).unwrap(),
            Some(momento(2026, 8, 24, 18))
        );
    }

    /// Un evento sin regla está donde está: cuenta si cae del lado pedido.
    #[test]
    fn un_evento_suelto_cuenta_una_sola_vez() {
        let c = db::en_memoria();
        let grupo_id = grupo::listar(&c).unwrap()[0].id;
        let (id, _) = evento::crear(
            &c,
            EventoNuevo {
                grupo_id,
                titulo: "Entrega informe HPC".to_string(),
                inicio: momento(2024, 3, 7, 18),
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
                uid: None,
            },
        )
        .unwrap();
        let evento = evento::leer(&c, id).unwrap();

        assert_eq!(primera_desde(&c, &evento, dia(2026, 8, 26)).unwrap(), None);
        assert_eq!(
            ultima_hasta(&c, &evento, dia(2026, 8, 26)).unwrap(),
            Some(momento(2024, 3, 7, 18))
        );
    }
}
