//! Resolución de la hora real de un evento.

use chrono::{DateTime, Duration, LocalResult, NaiveDateTime, Offset, TimeZone, Utc};
use chrono_tz::Tz;

use crate::modelo::{Cuando, Error};

/// Un evento tal como está en la base.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tramo {
    pub inicio: NaiveDateTime,
    pub fin: Option<NaiveDateTime>,
    pub cuando: Cuando,
}

/// El mismo evento en la hora de reloj del equipo. Es lo que se dibuja.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TramoResuelto {
    pub inicio: NaiveDateTime,
    pub fin: Option<NaiveDateTime>,
}

/// La función. Todo lo demás en este archivo es privado o auxiliar.
pub fn resolver(tramo: Tramo, zona_local: Tz) -> TramoResuelto {
    match tramo.cuando {
        Cuando::TodoElDia | Cuando::Fija => TramoResuelto {
            inicio: tramo.inicio,
            fin: tramo.fin,
        },
        Cuando::Adaptable(origen) => TramoResuelto {
            inicio: convertir(tramo.inicio, origen, zona_local),
            fin: tramo.fin.map(|f| convertir(f, origen, zona_local)),
        },
    }
}

/// La zona horaria instalada en el equipo, con su nombre IANA.
pub fn zona_del_equipo() -> Result<Tz, Error> {
    let nombre =
        iana_time_zone::get_timezone().map_err(|e| Error::ZonaDelEquipo(e.to_string()))?;

    nombre.parse::<Tz>().map_err(|_| {
        Error::ZonaDelEquipo(format!("el sistema reporta '{nombre}', que no es una zona conocida"))
    })
}

fn convertir(hora: NaiveDateTime, origen: Tz, destino: Tz) -> NaiveDateTime {
    anclar(hora, origen).with_timezone(&destino).naive_local()
}

/// Convierte una hora de reloj en un instante.
fn anclar(hora: NaiveDateTime, zona: Tz) -> DateTime<Tz> {
    match zona.from_local_datetime(&hora) {
        LocalResult::Single(t) => t,
        LocalResult::Ambiguous(primera, _) => primera,
        LocalResult::None => primera_hora_tras_el_salto(hora, zona),
    }
}

/// La hora de reloj no existe: al adelantar, el reloj pasó por encima de ella.
fn primera_hora_tras_el_salto(hora: NaiveDateTime, zona: Tz) -> DateTime<Tz> {
    let desfase_previo = zona
        .from_local_datetime(&(hora - Duration::days(1)))
        .earliest()
        .expect("24 horas antes de un salto no puede caer en otro salto")
        .offset()
        .fix()
        .local_minus_utc();

    Utc.from_utc_datetime(&(hora - Duration::seconds(desfase_previo as i64)))
        .with_timezone(&zona)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use chrono::NaiveDate;
    use chrono_tz::America::Santiago;
    use chrono_tz::Asia::Tokyo;
    use chrono_tz::Europe::Madrid;

    fn hora(a: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(a, m, d)
            .unwrap()
            .and_hms_opt(h, min, 0)
            .unwrap()
    }

    fn fijo(inicio: NaiveDateTime) -> Tramo {
        Tramo { inicio, fin: None, cuando: Cuando::Fija }
    }

    fn adaptable(inicio: NaiveDateTime, origen: Tz) -> Tramo {
        Tramo { inicio, fin: None, cuando: Cuando::Adaptable(origen) }
    }

    /// Una clase a las 09:00 sigue a las 09:00 tras el cambio de horario.
    #[test]
    fn hora_fija_no_se_mueve_con_el_horario_de_verano() {
        let antes = fijo(hora(2026, 8, 20, 9, 0));
        let despues = fijo(hora(2026, 9, 10, 9, 0));

        assert_eq!(resolver(antes, Santiago).inicio, hora(2026, 8, 20, 9, 0));
        assert_eq!(resolver(despues, Santiago).inicio, hora(2026, 9, 10, 9, 0));
    }

    /// Una partida coordinada desde Madrid mantiene el instante, no la hora.
    #[test]
    fn hora_adaptable_se_mueve_para_mantener_el_instante() {
        let antes = adaptable(hora(2026, 8, 20, 2, 0), Madrid);
        let despues = adaptable(hora(2026, 9, 10, 2, 0), Madrid);

        assert_eq!(resolver(antes, Santiago).inicio, hora(2026, 8, 19, 20, 0));
        assert_eq!(resolver(despues, Santiago).inicio, hora(2026, 9, 9, 21, 0));
    }

    /// El mediodía en Tokio es la noche anterior en Chile.
    #[test]
    fn hora_adaptable_puede_caer_en_otro_dia() {
        let t = adaptable(hora(2026, 8, 12, 12, 0), Tokyo);

        assert_eq!(resolver(t, Santiago).inicio, hora(2026, 8, 11, 23, 0));
    }

    /// Un evento de dos horas en Tokio cruza la medianoche al llegar a Chile.
    #[test]
    fn un_evento_puede_volverse_multi_dia_al_resolverse() {
        let t = Tramo {
            inicio: hora(2026, 8, 12, 12, 0),
            fin: Some(hora(2026, 8, 12, 14, 0)),
            cuando: Cuando::Adaptable(Tokyo),
        };
        let r = resolver(t, Santiago);

        assert_eq!(r.inicio, hora(2026, 8, 11, 23, 0));
        assert_eq!(r.fin, Some(hora(2026, 8, 12, 1, 0)));
        assert_ne!(r.inicio.date(), r.fin.unwrap().date());
    }

    /// Las 00:30 no existen el día que Chile adelanta el reloj.
    #[test]
    fn hora_inexistente_se_corre_tras_el_salto() {
        let t = adaptable(hora(2026, 9, 6, 0, 30), Santiago);

        assert_eq!(resolver(t, Santiago).inicio, hora(2026, 9, 6, 1, 30));
    }

    /// Al atrasar el reloj, las 23:30 ocurren dos veces. Se toma la primera.
    #[test]
    fn hora_repetida_toma_la_primera_pasada() {
        let t = adaptable(hora(2026, 4, 4, 23, 30), Santiago);

        assert_eq!(resolver(t, Madrid).inicio, hora(2026, 4, 5, 4, 30));
    }

    /// En su propia zona, adaptable se comporta igual que fija.
    #[test]
    fn adaptable_es_identidad_en_su_propia_zona() {
        let t = hora(2026, 12, 25, 21, 0);

        assert_eq!(
            resolver(adaptable(t, Santiago), Santiago).inicio,
            resolver(fijo(t), Santiago).inicio
        );
    }

    /// Un día es un día: todo el día no se convierte nunca.
    #[test]
    fn todo_el_dia_no_se_convierte_nunca() {
        let t = Tramo {
            inicio: hora(2026, 8, 7, 0, 0),
            fin: Some(hora(2026, 8, 9, 0, 0)),
            cuando: Cuando::TodoElDia,
        };

        for zona in [Santiago, Madrid, Tokyo] {
            let r = resolver(t, zona);
            assert_eq!(r.inicio, hora(2026, 8, 7, 0, 0));
            assert_eq!(r.fin, Some(hora(2026, 8, 9, 0, 0)));
        }
    }
}
