//! El canal único de modificación.

use std::sync::Mutex;

use rusqlite::Connection;

use crate::evento;
use crate::grupo;
use crate::modelo::{Adjunto, Error, Evento, EventoCompleto, Grupo, Notificacion};
use crate::ocurrencia;

/// Lo que ocurrió, con lo justo para poder revertirlo.
#[derive(Debug, Clone)]
pub enum Accion {
    GrupoCreado { id: i64 },
    GrupoEditado { antes: Grupo },
    /// Borrar un grupo mueve sus eventos al grupo por defecto; la lista se captura acá.
    GrupoBorrado { grupo: Grupo, eventos: Vec<i64> },
    /// El orden completo que tenían los grupos antes de moverlos.
    GruposReordenados { antes: Vec<i64> },

    EventoCreado { id: i64 },
    /// Las notificaciones son `None` si la edición no movió ninguna hora. Los
    /// adjuntos no: la edición siempre declara la lista que tiene que quedar.
    EventoEditado {
        antes: Evento,
        notificaciones: Option<Vec<Notificacion>>,
        adjuntos: Vec<Adjunto>,
    },
    /// Borrar un evento se lleva por cascada todo lo que cuelga de él.
    EventoBorrado(EventoCompleto),

    /// Una ocurrencia sacada de su serie, con o sin evento que la reemplace.
    OcurrenciaExcluida {
        maestro_id: i64,
        fecha_original: String,
    },
    /// La reversión de la anterior. Guarda el reemplazo para poder devolverlo.
    OcurrenciaDevuelta {
        maestro_id: i64,
        fecha_original: String,
        reemplazo: Option<EventoCompleto>,
    },
}

/// Deshace una acción y devuelve la acción que desharía esta reversión.
fn revertir(conexion: &Connection, accion: Accion) -> Result<Accion, Error> {
    match accion {
        Accion::GrupoCreado { id } => grupo::borrar(conexion, id),
        Accion::GrupoEditado { antes } => grupo::escribir(conexion, &antes),
        Accion::GrupoBorrado { grupo, eventos } => grupo::restaurar(conexion, &grupo, &eventos),
        Accion::GruposReordenados { antes } => grupo::reordenar(conexion, &antes),

        Accion::EventoCreado { id } => evento::borrar(conexion, id),
        Accion::EventoEditado {
            antes,
            notificaciones,
            adjuntos,
        } => evento::escribir(conexion, &antes, notificaciones.as_deref(), &adjuntos),
        Accion::EventoBorrado(completo) => evento::restaurar(conexion, &completo),

        Accion::OcurrenciaExcluida {
            maestro_id,
            fecha_original,
        } => ocurrencia::devolver(conexion, maestro_id, &fecha_original),
        Accion::OcurrenciaDevuelta {
            maestro_id,
            fecha_original,
            reemplazo,
        } => ocurrencia::restaurar(conexion, maestro_id, &fecha_original, reemplazo.as_ref()),
    }
}

/// Las dos pilas.
#[derive(Default)]
pub struct Historial {
    hecho: Vec<Accion>,
    deshecho: Vec<Accion>,
}

impl Historial {
    /// Registra una acción recién ejecutada.
    pub fn registrar(&mut self, accion: Accion) {
        self.hecho.push(accion);
        self.deshecho.clear();
    }

    /// Devuelve `false` si no había nada que deshacer.
    pub fn deshacer(&mut self, conexion: &Connection) -> Result<bool, Error> {
        match self.hecho.pop() {
            None => Ok(false),
            Some(accion) => {
                self.deshecho.push(revertir(conexion, accion)?);
                Ok(true)
            }
        }
    }

    /// Devuelve `false` si no había nada que rehacer.
    pub fn rehacer(&mut self, conexion: &Connection) -> Result<bool, Error> {
        match self.deshecho.pop() {
            None => Ok(false),
            Some(accion) => {
                self.hecho.push(revertir(conexion, accion)?);
                Ok(true)
            }
        }
    }

    pub fn hay_para_deshacer(&self) -> bool {
        !self.hecho.is_empty()
    }

    pub fn hay_para_rehacer(&self) -> bool {
        !self.deshecho.is_empty()
    }
}

/// El historial guardado como estado de la aplicación.
pub struct Pila(pub Mutex<Historial>);
