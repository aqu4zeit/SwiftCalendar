//! La consulta única de rango. Decisión 51.

use std::collections::{BTreeMap, HashMap};

use chrono::{Duration, NaiveDate, NaiveDateTime, NaiveTime};
use chrono_tz::Tz;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::evento;
use crate::grupo;
use crate::hora::{self, Tramo};
use crate::modelo::{self, Cuando, Error, Importancia};
use crate::recurrencia;

/// Días leídos de más a cada lado del rango pedido, por los eventos adaptables.
const MARGEN_DIAS: i64 = 2;

/// Los dos ejes de filtrado. Ambos son listas explícitas de lo que se muestra.
#[derive(Debug, Clone, Deserialize)]
pub struct Filtros {
    pub grupos: Vec<i64>,
    pub importancias: Vec<Importancia>,
}

/// Un evento resuelto, en un día concreto, listo para dibujar.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Instancia {
    pub evento_id: i64,
    /// La ocurrencia en hora guardada. Es la clave de excepciones y notificaciones.
    #[serde(serialize_with = "modelo::serializar_fecha")]
    pub ocurrencia: NaiveDateTime,

    pub titulo: String,
    pub descripcion: Option<String>,
    pub miniatura: Option<String>,

    pub grupo_id: i64,
    /// Ya resuelto: el del evento si lo declara, el del grupo si no.
    pub color: String,
    pub orden_grupo: i64,
    pub importancia: Importancia,

    /// Hora de reloj del equipo. Es la que se muestra.
    #[serde(serialize_with = "modelo::serializar_fecha")]
    pub inicio: NaiveDateTime,
    #[serde(serialize_with = "modelo::serializar_fecha_opcional")]
    pub fin: Option<NaiveDateTime>,
    pub todo_el_dia: bool,

    /// "Día N de M" para los multi-día. Un evento de un solo día es 1 de 1.
    pub dia: u32,
    pub de: u32,
}

/// Los eventos de cada día del rango, resueltos, filtrados y ordenados.
pub fn eventos_en_rango(
    conexion: &Connection,
    desde: NaiveDate,
    hasta: NaiveDate,
    filtros: &Filtros,
    zona_local: Tz,
) -> Result<BTreeMap<NaiveDate, Vec<Instancia>>, Error> {
    let margen = Duration::days(MARGEN_DIAS);
    let lectura_desde = desde - margen;
    let lectura_hasta = hasta + margen;

    let grupos: HashMap<i64, (String, i64)> = grupo::listar(conexion)?
        .into_iter()
        .map(|g| (g.id, (g.color, g.orden)))
        .collect();

    let eventos = evento::leer_en_rango(conexion, lectura_desde, lectura_hasta)?;
    let mut por_dia: BTreeMap<NaiveDate, Vec<Instancia>> = BTreeMap::new();

    for e in eventos {
        // Filtrar antes de expandir.
        if !filtros.grupos.contains(&e.grupo_id) {
            continue;
        }
        if !filtros.importancias.contains(&e.importancia) {
            continue;
        }

        let (color_grupo, orden_grupo) = grupos.get(&e.grupo_id).ok_or_else(|| {
            Error::DatoCorrupto(format!(
                "el evento {} apunta al grupo {}, que no existe",
                e.id, e.grupo_id
            ))
        })?;

        let duracion = match e.fin {
            Some(fin) => fin - e.inicio,
            None => Duration::zero(),
        };

        let ocurrencias = recurrencia::ocurrencias(
            conexion,
            &e,
            lectura_desde - Duration::days(duracion.num_days()),
            lectura_hasta,
        )?;

        let todo_el_dia = e.cuando == Cuando::TodoElDia;

        for ocurrencia in ocurrencias {
            let resuelto = hora::resolver(
                Tramo {
                    inicio: ocurrencia,
                    fin: e.fin.map(|_| ocurrencia + duracion),
                    cuando: e.cuando,
                },
                zona_local,
            );

            let primer_dia = resuelto.inicio.date();
            let ultimo_dia = ultimo_dia(&resuelto, todo_el_dia);
            let total = (ultimo_dia - primer_dia).num_days() + 1;

            for n in 0..total {
                let dia = primer_dia + Duration::days(n);
                if dia < desde || dia > hasta {
                    continue;
                }

                por_dia.entry(dia).or_default().push(Instancia {
                    evento_id: e.id,
                    ocurrencia,
                    titulo: e.titulo.clone(),
                    descripcion: e.descripcion.clone(),
                    miniatura: e.imagen.as_ref().map(|i| i.miniatura.clone()),
                    grupo_id: e.grupo_id,
                    color: e.color.clone().unwrap_or_else(|| color_grupo.clone()),
                    orden_grupo: *orden_grupo,
                    importancia: e.importancia,
                    inicio: resuelto.inicio,
                    fin: resuelto.fin,
                    todo_el_dia,
                    dia: (n + 1) as u32,
                    de: total as u32,
                });
            }
        }
    }

    for lista in por_dia.values_mut() {
        // Todo el día primero, después por instante, y a igualdad manda el grupo.
        lista.sort_by(|a, b| {
            b.todo_el_dia
                .cmp(&a.todo_el_dia)
                .then(a.inicio.cmp(&b.inicio))
                .then(a.orden_grupo.cmp(&b.orden_grupo))
                .then(a.evento_id.cmp(&b.evento_id))
        });
    }

    Ok(por_dia)
}

/// El último día que ocupa un tramo ya resuelto.
fn ultimo_dia(resuelto: &hora::TramoResuelto, todo_el_dia: bool) -> NaiveDate {
    let Some(fin) = resuelto.fin else {
        return resuelto.inicio.date();
    };

    let termina_a_medianoche =
        !todo_el_dia && fin.time() == NaiveTime::MIN && fin.date() > resuelto.inicio.date();

    if termina_a_medianoche {
        fin.date() - Duration::days(1)
    } else {
        fin.date()
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db;
    use crate::historial::Accion;
    use crate::modelo::{EventoNuevo, GrupoNuevo};
    use chrono_tz::America::Santiago;
    use chrono_tz::Asia::Tokyo;

    fn dia(a: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(a, m, d).unwrap()
    }

    fn momento(a: i32, m: u32, d: u32, h: u32, min: u32) -> NaiveDateTime {
        dia(a, m, d).and_hms_opt(h, min, 0).unwrap()
    }

    fn grupo_defecto(conexion: &Connection) -> i64 {
        grupo::listar(conexion).unwrap()[0].id
    }

    /// Todas las casillas marcadas, que es el estado por defecto de la app.
    fn todo(conexion: &Connection) -> Filtros {
        Filtros {
            grupos: grupo::listar(conexion)
                .unwrap()
                .into_iter()
                .map(|g| g.id)
                .collect(),
            importancias: vec![
                Importancia::Comun,
                Importancia::Importante,
                Importancia::Urgente,
            ],
        }
    }

    fn base(grupo_id: i64, titulo: &str, inicio: NaiveDateTime) -> EventoNuevo {
        EventoNuevo {
            grupo_id,
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

    fn crear(conexion: &Connection, nuevo: EventoNuevo) -> i64 {
        evento::crear(conexion, nuevo).unwrap().0
    }

    fn consultar(
        conexion: &Connection,
        desde: NaiveDate,
        hasta: NaiveDate,
    ) -> BTreeMap<NaiveDate, Vec<Instancia>> {
        eventos_en_rango(conexion, desde, hasta, &todo(conexion), Santiago).unwrap()
    }

    /// Terminar a las 00:00 pertenece al día anterior. No aplica a todo el día.
    #[test]
    fn evento_de_20_a_00_aparece_solo_en_el_dia_de_inicio() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut e = base(g, "Regar las plantas", momento(2026, 8, 12, 20, 0));
        e.fin = Some(momento(2026, 8, 13, 0, 0));
        crear(&c, e);

        let r = consultar(&c, dia(2026, 8, 1), dia(2026, 8, 31));

        assert_eq!(r[&dia(2026, 8, 12)].len(), 1);
        assert_eq!(r[&dia(2026, 8, 12)][0].de, 1, "no es multi-día");
        assert!(!r.contains_key(&dia(2026, 8, 13)));
    }

    /// Cruzar la medianoche de verdad sí ocupa los dos días.
    #[test]
    fn evento_de_23_a_04_aparece_en_los_dos_dias() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut e = base(g, "Stream con Ale", momento(2026, 8, 12, 23, 0));
        e.fin = Some(momento(2026, 8, 13, 4, 0));
        crear(&c, e);

        let r = consultar(&c, dia(2026, 8, 1), dia(2026, 8, 31));

        let primero = &r[&dia(2026, 8, 12)][0];
        let segundo = &r[&dia(2026, 8, 13)][0];

        assert_eq!((primero.dia, primero.de), (1, 2));
        assert_eq!((segundo.dia, segundo.de), (2, 2));
        assert_eq!(primero.evento_id, segundo.evento_id, "es el mismo evento");
    }

    /// La regla de las 00:00 no aplica a los de todo el día: les quitaría un día.
    #[test]
    fn todo_el_dia_de_tres_dias_reporta_dia_2_de_3_desde_el_segundo() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut e = base(g, "Visita a los abuelos", momento(2026, 8, 7, 0, 0));
        e.fin = Some(momento(2026, 8, 9, 0, 0));
        e.cuando = Cuando::TodoElDia;
        crear(&c, e);

        let r = consultar(&c, dia(2026, 8, 8), dia(2026, 8, 8));

        assert_eq!(r.len(), 1, "solo se pidió un día");
        let i = &r[&dia(2026, 8, 8)][0];
        assert_eq!((i.dia, i.de), (2, 3));
        assert!(i.todo_el_dia);
    }

    /// En hora guardada cae fuera del rango; al resolverse cae dentro.
    #[test]
    fn adaptable_de_otra_zona_entra_al_rango_al_resolverse() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut e = base(g, "Partida con el clan", momento(2026, 8, 12, 12, 0));
        e.cuando = Cuando::Adaptable(Tokyo);
        crear(&c, e);

        let r = consultar(&c, dia(2026, 8, 11), dia(2026, 8, 11));

        assert_eq!(r[&dia(2026, 8, 11)][0].inicio, momento(2026, 8, 11, 23, 0));
        assert!(!r.contains_key(&dia(2026, 8, 12)), "el día guardado no vale");
    }

    /// Un evento cuyo día de inicio queda fuera del rango pero cuyo tramo lo cruza.
    #[test]
    fn evento_largo_que_empieza_antes_del_rango_aparece_igual() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut e = base(g, "Vacaciones", momento(2026, 8, 1, 10, 0));
        e.fin = Some(momento(2026, 8, 20, 12, 0));
        crear(&c, e);

        let r = consultar(&c, dia(2026, 8, 10), dia(2026, 8, 15));

        assert_eq!(r.len(), 6, "los seis días pedidos");
        let i = &r[&dia(2026, 8, 10)][0];
        assert_eq!((i.dia, i.de), (10, 20));
    }

    /// Una serie de 2024 sigue produciendo ocurrencias en 2026.
    #[test]
    fn una_serie_antigua_sigue_produciendo_ocurrencias() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut e = base(g, "Clase de redes", momento(2024, 8, 5, 9, 0));
        e.rrule = Some("FREQ=WEEKLY".to_string());
        crear(&c, e);

        let r = consultar(&c, dia(2026, 8, 1), dia(2026, 8, 31));

        assert_eq!(r.len(), 5, "los cinco lunes de agosto de 2026");
        assert!(r.contains_key(&dia(2026, 8, 3)));
        assert!(r.contains_key(&dia(2026, 8, 31)));
    }

    /// La ocurrencia excluida no llega hasta acá.
    #[test]
    fn una_excepcion_borra_su_ocurrencia_de_la_consulta() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        let mut e = base(g, "Clase de redes", momento(2026, 8, 3, 9, 0));
        e.rrule = Some("FREQ=WEEKLY".to_string());
        let id = crear(&c, e);

        c.execute(
            "INSERT INTO excepcion (evento_id, fecha_original, override_id)
             VALUES (?1, '2026-08-17 09:00', NULL)",
            [id],
        )
        .unwrap();

        let r = consultar(&c, dia(2026, 8, 1), dia(2026, 8, 31));

        assert_eq!(r.len(), 4);
        assert!(!r.contains_key(&dia(2026, 8, 17)));
        assert!(r.contains_key(&dia(2026, 8, 24)));
    }

    /// Los dos ejes se aplican a la vez: grupo Y importancia.
    #[test]
    fn los_dos_filtros_se_combinan() {
        let c = db::en_memoria();
        let otro = grupo_defecto(&c);

        let Accion::GrupoCreado { id: universidad } = grupo::crear(
            &c,
            GrupoNuevo {
                nombre: "Universidad".to_string(),
                color: "#cf8f3c".to_string(),
            },
        )
        .unwrap() else {
            panic!("se esperaba GrupoCreado");
        };

        let mut certamen = base(universidad, "Certamen cálculo", momento(2026, 8, 5, 8, 30));
        certamen.importancia = Importancia::Urgente;
        crear(&c, certamen);

        let mut ayudantia = base(universidad, "Ayudantía", momento(2026, 8, 5, 11, 0));
        ayudantia.importancia = Importancia::Comun;
        crear(&c, ayudantia);

        let mut compras = base(otro, "Compras", momento(2026, 8, 5, 18, 0));
        compras.importancia = Importancia::Urgente;
        crear(&c, compras);

        let filtros = Filtros {
            grupos: vec![universidad],
            importancias: vec![Importancia::Urgente],
        };
        let r = eventos_en_rango(&c, dia(2026, 8, 5), dia(2026, 8, 5), &filtros, Santiago).unwrap();

        assert_eq!(r[&dia(2026, 8, 5)].len(), 1);
        assert_eq!(r[&dia(2026, 8, 5)][0].titulo, "Certamen cálculo");
    }

    /// Todas las casillas desmarcadas no devuelve nada.
    #[test]
    fn sin_ningun_grupo_marcado_no_se_devuelve_nada() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);
        crear(&c, base(g, "Compras", momento(2026, 8, 5, 18, 0)));

        let filtros = Filtros {
            grupos: vec![],
            importancias: vec![Importancia::Comun],
        };
        let r = eventos_en_rango(&c, dia(2026, 8, 1), dia(2026, 8, 31), &filtros, Santiago).unwrap();

        assert!(r.is_empty());
    }

    /// Todo el día primero, después el reloj.
    #[test]
    fn el_orden_pone_todo_el_dia_primero_y_despues_la_hora() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        crear(&c, base(g, "Dentista", momento(2026, 8, 12, 16, 30)));

        let mut clase = base(g, "Clase de redes", momento(2026, 8, 12, 9, 0));
        clase.importancia = Importancia::Urgente;
        crear(&c, clase);

        let mut visita = base(g, "Visita a los abuelos", momento(2026, 8, 12, 0, 0));
        visita.cuando = Cuando::TodoElDia;
        crear(&c, visita);

        let r = consultar(&c, dia(2026, 8, 12), dia(2026, 8, 12));
        let titulos: Vec<&str> = r[&dia(2026, 8, 12)]
            .iter()
            .map(|i| i.titulo.as_str())
            .collect();

        assert_eq!(
            titulos,
            vec!["Visita a los abuelos", "Clase de redes", "Dentista"]
        );
    }

    /// El color nulo hereda del grupo, y el declarado gana.
    #[test]
    fn el_color_llega_resuelto() {
        let c = db::en_memoria();
        let g = grupo_defecto(&c);

        crear(&c, base(g, "Hereda", momento(2026, 8, 12, 9, 0)));

        let mut propio = base(g, "Propio", momento(2026, 8, 12, 10, 0));
        propio.color = Some("#4f9e8c".to_string());
        crear(&c, propio);

        let r = consultar(&c, dia(2026, 8, 12), dia(2026, 8, 12));
        let lista = &r[&dia(2026, 8, 12)];

        assert_eq!(lista[0].color, "#8b857e", "el color del grupo Otro");
        assert_eq!(lista[1].color, "#4f9e8c");
    }
}
