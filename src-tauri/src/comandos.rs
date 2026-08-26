//! La capa de borde entre el lado nativo y la interfaz.

use std::collections::{BTreeMap, HashMap};

use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::ajuste;
use crate::archivo::{self, Carpeta};
use crate::db::Base;
use crate::evento;
use crate::grupo;
use crate::historial::{Accion, Pila};
use crate::hora;
use crate::modelo::{
    self, Adjunto, Cuando, Evento, EventoNuevo, Grupo, GrupoNuevo, Imagen, Importancia, FORMATO,
};
use crate::ocurrencia;
use crate::rango::{self, Filtros, Instancia};

/// Las fechas de un rango son días, no instantes.
const FORMATO_DIA: &str = "%Y-%m-%d";

fn dia(texto: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(texto, FORMATO_DIA)
        .map_err(|_| format!("la fecha '{texto}' no tiene el formato AAAA-MM-DD"))
}

fn momento(texto: &str) -> Result<NaiveDateTime, String> {
    NaiveDateTime::parse_from_str(texto, FORMATO)
        .map_err(|_| format!("la fecha '{texto}' no tiene el formato AAAA-MM-DD HH:MM"))
}

/// La zona de origen no llega desde la interfaz: se averigua acá.
fn cuando(palabra: &str) -> Result<Cuando, String> {
    match palabra {
        "todo_el_dia" => Ok(Cuando::TodoElDia),
        "fija" => Ok(Cuando::Fija),
        "adaptable" => Ok(Cuando::Adaptable(
            hora::zona_del_equipo().map_err(|e| e.to_string())?,
        )),
        otro => Err(format!("tipo de hora desconocido: '{otro}'")),
    }
}

/// Los eventos de cada día del rango, resueltos y listos para dibujar.
#[tauri::command]
pub fn eventos_en_rango(
    base: State<'_, Base>,
    desde: String,
    hasta: String,
    filtros: Filtros,
) -> Result<BTreeMap<String, Vec<Instancia>>, String> {
    let zona = hora::zona_del_equipo().map_err(|e| e.to_string())?;
    let desde = dia(&desde)?;
    let hasta = dia(&hasta)?;

    let conexion = base.0.lock().expect("la conexión quedó envenenada");

    let por_dia = rango::eventos_en_rango(&conexion, desde, hasta, &filtros, zona)
        .map_err(|e| e.to_string())?;

    Ok(por_dia
        .into_iter()
        .map(|(fecha, lista)| (fecha.format(FORMATO_DIA).to_string(), lista))
        .collect())
}

/// Los grupos, en su orden.
#[tauri::command]
pub fn listar_grupos(base: State<'_, Base>) -> Result<Vec<Grupo>, String> {
    let conexion = base.0.lock().expect("la conexión quedó envenenada");
    grupo::listar(&conexion).map_err(|e| e.to_string())
}

/// Lo que manda la interfaz para crear o editar un grupo.
#[derive(Debug, Deserialize)]
pub struct GrupoDeLaInterfaz {
    nombre: String,
    color: String,
}

/// Crea un grupo y devuelve su identificador.
#[tauri::command]
pub fn crear_grupo(
    base: State<'_, Base>,
    pila: State<'_, Pila>,
    grupo: GrupoDeLaInterfaz,
) -> Result<i64, String> {
    let conexion = base.0.lock().expect("la conexión quedó envenenada");

    let accion = grupo::crear(
        &conexion,
        GrupoNuevo {
            nombre: grupo.nombre,
            color: grupo.color,
        },
    )
    .map_err(|e| e.to_string())?;

    let Accion::GrupoCreado { id } = accion else {
        return Err("crear grupo devolvió una acción inesperada".to_string());
    };

    pila.0
        .lock()
        .expect("el historial quedó envenenado")
        .registrar(Accion::GrupoCreado { id });

    Ok(id)
}

/// Cambia el nombre y el color de un grupo. El orden se mueve aparte.
#[tauri::command]
pub fn editar_grupo(
    base: State<'_, Base>,
    pila: State<'_, Pila>,
    id: i64,
    grupo: GrupoDeLaInterfaz,
) -> Result<(), String> {
    let conexion = base.0.lock().expect("la conexión quedó envenenada");
    let actual = grupo::leer(&conexion, id).map_err(|e| e.to_string())?;

    let accion = grupo::editar(
        &conexion,
        &Grupo {
            nombre: grupo.nombre,
            color: grupo.color,
            ..actual
        },
    )
    .map_err(|e| e.to_string())?;

    pila.0
        .lock()
        .expect("el historial quedó envenenado")
        .registrar(accion);

    Ok(())
}

/// Borra un grupo. Sus eventos se mueven al grupo por defecto.
#[tauri::command]
pub fn borrar_grupo(
    base: State<'_, Base>,
    pila: State<'_, Pila>,
    id: i64,
) -> Result<(), String> {
    let conexion = base.0.lock().expect("la conexión quedó envenenada");
    let accion = grupo::borrar(&conexion, id).map_err(|e| e.to_string())?;

    pila.0
        .lock()
        .expect("el historial quedó envenenado")
        .registrar(accion);

    Ok(())
}

/// Escribe el orden completo de los grupos.
#[tauri::command]
pub fn reordenar_grupos(
    base: State<'_, Base>,
    pila: State<'_, Pila>,
    ids: Vec<i64>,
) -> Result<(), String> {
    let conexion = base.0.lock().expect("la conexión quedó envenenada");
    let accion = grupo::reordenar(&conexion, &ids).map_err(|e| e.to_string())?;

    pila.0
        .lock()
        .expect("el historial quedó envenenado")
        .registrar(accion);

    Ok(())
}

/// Los ajustes guardados, todos juntos.
#[tauri::command]
pub fn listar_ajustes(base: State<'_, Base>) -> Result<HashMap<String, String>, String> {
    let conexion = base.0.lock().expect("la conexión quedó envenenada");
    ajuste::todos(&conexion).map_err(|e| e.to_string())
}

/// Qué imagen tiene que quedar guardada en el evento.
///
/// Las tres opciones son estados distintos y no se pueden confundir entre sí.
/// Con un solo campo opcional habría que adivinar si una ruta es la que ya
/// estaba o una nueva por copiar, y eso es una decisión sin dueño.
#[derive(Debug, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum ImagenPedida {
    /// El evento queda sin imagen. También es lo que se manda al quitarla.
    Sin,
    /// La que ya está en la carpeta de datos, tal cual.
    Guardada { original: String, miniatura: String },
    /// Un archivo del disco que hay que copiar y del que hay que sacar la miniatura.
    Nueva { origen: String },
}

/// Qué adjunto tiene que quedar guardado.
///
/// Las dos formas son las mismas de la imagen, menos la de "sin": eso es la
/// lista vacía. Un evento editado manda su lista completa, así que un adjunto
/// que ya estaba viaja como `Guardado` y no se vuelve a copiar.
#[derive(Debug, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum AdjuntoPedido {
    Guardado {
        ruta: String,
        nombre_original: String,
        tamano: i64,
    },
    Nuevo {
        origen: String,
    },
}

/// Lo que manda la interfaz para crear o editar un evento.
#[derive(Debug, Deserialize)]
pub struct EventoDeLaInterfaz {
    grupo_id: i64,
    titulo: String,
    inicio: String,
    fin: Option<String>,
    cuando: String,
    importancia: Importancia,
    descripcion: Option<String>,
    ubicacion: Option<String>,
    url: Option<String>,
    imagen: ImagenPedida,
    adjuntos: Vec<AdjuntoPedido>,
    rrule: Option<String>,
    recordatorio_min: Option<i64>,
}

/// Copia la imagen si hace falta y devuelve lo que se guarda en la fila.
fn resolver_imagen(carpeta: &Carpeta, pedida: ImagenPedida) -> Result<Option<Imagen>, String> {
    match pedida {
        ImagenPedida::Sin => Ok(None),
        ImagenPedida::Guardada {
            original,
            miniatura,
        } => Ok(Some(Imagen {
            original,
            miniatura,
        })),
        ImagenPedida::Nueva { origen } => archivo::guardar_imagen(&carpeta.0, origen.as_ref())
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

/// Copia los archivos que hagan falta y devuelve la lista que se guarda.
fn resolver_adjuntos(
    carpeta: &Carpeta,
    pedidos: Vec<AdjuntoPedido>,
) -> Result<Vec<Adjunto>, String> {
    pedidos
        .into_iter()
        .map(|pedido| match pedido {
            AdjuntoPedido::Guardado {
                ruta,
                nombre_original,
                tamano,
            } => Ok(Adjunto {
                ruta,
                nombre_original,
                tamano,
            }),
            AdjuntoPedido::Nuevo { origen } => {
                archivo::guardar_adjunto(&carpeta.0, origen.as_ref()).map_err(|e| e.to_string())
            }
        })
        .collect()
}

fn a_evento_nuevo(e: EventoDeLaInterfaz, carpeta: &Carpeta) -> Result<EventoNuevo, String> {
    let imagen = resolver_imagen(carpeta, e.imagen)?;
    let adjuntos = resolver_adjuntos(carpeta, e.adjuntos)?;

    Ok(EventoNuevo {
        grupo_id: e.grupo_id,
        titulo: e.titulo,
        inicio: momento(&e.inicio)?,
        fin: e.fin.as_deref().map(momento).transpose()?,
        cuando: cuando(&e.cuando)?,
        importancia: e.importancia,
        color: None,
        descripcion: e.descripcion,
        ubicacion: e.ubicacion,
        url: e.url,
        imagen,
        rrule: e.rrule,
        recordatorio_min: e.recordatorio_min,
        adjuntos,
    })
}

/// Un evento como lo pide la ficha: la fila tal cual está guardada.
///
/// Cuándo ocurre esta ocurrencia lo dice la instancia que ya tiene la vista.
/// Acá viaja lo que la consulta de rango no lleva, porque la celda no lo usa.
#[derive(Debug, Serialize)]
pub struct EventoDetalle {
    id: i64,
    grupo_id: i64,
    titulo: String,
    #[serde(serialize_with = "modelo::serializar_fecha")]
    inicio: NaiveDateTime,
    #[serde(serialize_with = "modelo::serializar_fecha_opcional")]
    fin: Option<NaiveDateTime>,
    cuando: &'static str,
    importancia: Importancia,
    descripcion: Option<String>,
    ubicacion: Option<String>,
    url: Option<String>,
    imagen: Option<String>,
    miniatura: Option<String>,
    /// Falso si el archivo ya no está en la carpeta. La carpeta es del usuario
    /// y puede vaciarla a mano; la ficha lo dice en vez de dibujar un hueco.
    imagen_existe: bool,
    adjuntos: Vec<AdjuntoDetalle>,
    rrule: Option<String>,
    recordatorio_min: Option<i64>,
}

/// Un adjunto como lo pide la ficha, con la misma advertencia que la imagen.
#[derive(Debug, Serialize)]
pub struct AdjuntoDetalle {
    ruta: String,
    nombre_original: String,
    tamano: i64,
    existe: bool,
}

/// Un evento por su identificador.
#[tauri::command]
pub fn leer_evento(
    base: State<'_, Base>,
    carpeta: State<'_, Carpeta>,
    id: i64,
) -> Result<EventoDetalle, String> {
    let conexion = base.0.lock().expect("la conexión quedó envenenada");
    let e = evento::leer(&conexion, id).map_err(|e| e.to_string())?;

    let imagen_existe = e
        .imagen
        .as_ref()
        .is_some_and(|i| archivo::existe(&carpeta.0, &i.original));

    let adjuntos = evento::adjuntos_de(&conexion, id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|a| AdjuntoDetalle {
            existe: archivo::existe(&carpeta.0, &a.ruta),
            ruta: a.ruta,
            nombre_original: a.nombre_original,
            tamano: a.tamano,
        })
        .collect();

    Ok(EventoDetalle {
        id: e.id,
        grupo_id: e.grupo_id,
        titulo: e.titulo,
        inicio: e.inicio,
        fin: e.fin,
        cuando: e.cuando.como_texto(),
        importancia: e.importancia,
        descripcion: e.descripcion,
        ubicacion: e.ubicacion,
        url: e.url,
        imagen: e.imagen.as_ref().map(|i| i.original.clone()),
        miniatura: e.imagen.as_ref().map(|i| i.miniatura.clone()),
        imagen_existe,
        adjuntos,
        rrule: e.rrule,
        recordatorio_min: e.recordatorio_min,
    })
}

/// Crea un evento y deja la acción registrada para poder deshacerla.
#[tauri::command]
pub fn crear_evento(
    base: State<'_, Base>,
    pila: State<'_, Pila>,
    carpeta: State<'_, Carpeta>,
    evento: EventoDeLaInterfaz,
) -> Result<i64, String> {
    let nuevo = a_evento_nuevo(evento, &carpeta)?;

    let conexion = base.0.lock().expect("la conexión quedó envenenada");
    let (id, accion) = evento::crear(&conexion, nuevo).map_err(|e| e.to_string())?;

    pila.0
        .lock()
        .expect("el historial quedó envenenado")
        .registrar(accion);

    Ok(id)
}

/// Los campos que edita el formulario, encima de la fila que ya existe.
///
/// El color no lo toca el formulario, así que se conserva.
fn con_los_campos(actual: Evento, nuevo: EventoNuevo) -> Evento {
    Evento {
        grupo_id: nuevo.grupo_id,
        titulo: nuevo.titulo,
        inicio: nuevo.inicio,
        fin: nuevo.fin,
        cuando: nuevo.cuando,
        importancia: nuevo.importancia,
        descripcion: nuevo.descripcion,
        ubicacion: nuevo.ubicacion,
        url: nuevo.url,
        imagen: nuevo.imagen,
        rrule: nuevo.rrule,
        recordatorio_min: nuevo.recordatorio_min,
        ..actual
    }
}

/// Edita un evento. Con `ocurrencia` toca solo esa; sin ella, toda la serie.
#[tauri::command]
pub fn editar_evento(
    base: State<'_, Base>,
    pila: State<'_, Pila>,
    carpeta: State<'_, Carpeta>,
    id: i64,
    ocurrencia: Option<String>,
    evento: EventoDeLaInterfaz,
) -> Result<(), String> {
    let mut nuevo = a_evento_nuevo(evento, &carpeta)?;
    let conexion = base.0.lock().expect("la conexión quedó envenenada");

    let accion = match ocurrencia {
        Some(fecha) => {
            if nuevo.rrule.is_some() {
                return Err("una ocurrencia separada de su serie no puede repetirse".to_string());
            }
            let fecha = momento(&fecha)?.format(FORMATO).to_string();
            ocurrencia::excluir(&conexion, id, &fecha, Some(nuevo))
        }
        None => {
            let actual = evento::leer(&conexion, id).map_err(|e| e.to_string())?;
            let adjuntos = std::mem::take(&mut nuevo.adjuntos);
            evento::editar(&conexion, &con_los_campos(actual, nuevo), &adjuntos)
        }
    }
    .map_err(|e| e.to_string())?;

    pila.0
        .lock()
        .expect("el historial quedó envenenado")
        .registrar(accion);

    Ok(())
}

/// Borra un evento. Con `ocurrencia` borra solo esa; sin ella, toda la serie.
#[tauri::command]
pub fn borrar_evento(
    base: State<'_, Base>,
    pila: State<'_, Pila>,
    id: i64,
    ocurrencia: Option<String>,
) -> Result<(), String> {
    let conexion = base.0.lock().expect("la conexión quedó envenenada");

    let accion = match ocurrencia {
        Some(fecha) => {
            let fecha = momento(&fecha)?.format(FORMATO).to_string();
            ocurrencia::excluir(&conexion, id, &fecha, None)
        }
        None => evento::borrar(&conexion, id),
    }
    .map_err(|e| e.to_string())?;

    pila.0
        .lock()
        .expect("el historial quedó envenenado")
        .registrar(accion);

    Ok(())
}

#[cfg(test)]
mod pruebas {
    use super::*;

    /// El JSON exacto que arma `Formulario.tsx` al guardar.
    ///
    /// Es la prueba que faltaba: las demás llaman a `evento::insertar` sin cruzar
    /// el borde, así que un campo agregado acá y no en la interfaz pasaba
    /// desapercibido hasta que alguien apretaba Guardar.
    const CUERPO: &str = r#"{
        "grupo_id": 1,
        "titulo": "Reunión",
        "inicio": "2026-08-26 09:00",
        "fin": null,
        "cuando": "fija",
        "importancia": "comun",
        "descripcion": null,
        "ubicacion": null,
        "url": null,
        "imagen": { "tipo": "sin" },
        "adjuntos": [],
        "rrule": null,
        "recordatorio_min": null
    }"#;

    #[test]
    fn el_cuerpo_de_la_interfaz_se_deserializa() {
        let e: EventoDeLaInterfaz = serde_json::from_str(CUERPO).unwrap();

        assert_eq!(e.titulo, "Reunión");
        assert!(matches!(e.imagen, ImagenPedida::Sin));
        assert!(e.adjuntos.is_empty());
    }

    /// Un campo que la interfaz no manda tiene que fallar acá, no en producción.
    #[test]
    fn falta_un_campo_y_no_se_deserializa() {
        let sin_adjuntos = CUERPO.replace(r#""adjuntos": [],"#, "");

        assert!(serde_json::from_str::<EventoDeLaInterfaz>(&sin_adjuntos).is_err());
    }

    /// Las dos formas de pedir un adjunto llegan distinguidas.
    #[test]
    fn los_adjuntos_llegan_con_su_forma() {
        let con_adjuntos = CUERPO.replace(
            r#""adjuntos": [],"#,
            r#""adjuntos": [
                { "tipo": "guardado", "ruta": "assets/adjuntos/1.pdf",
                  "nombre_original": "rubrica.pdf", "tamano": 2048 },
                { "tipo": "nuevo", "origen": "C:\\Users\\yo\\notas.txt" }
            ],"#,
        );

        let e: EventoDeLaInterfaz = serde_json::from_str(&con_adjuntos).unwrap();

        assert!(matches!(e.adjuntos[0], AdjuntoPedido::Guardado { .. }));
        assert!(matches!(e.adjuntos[1], AdjuntoPedido::Nuevo { .. }));
    }
}
