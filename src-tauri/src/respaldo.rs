//! El respaldo: la carpeta de datos entera en un archivo, y de vuelta.
//!
//! No sabe nada de la base. Recibe rutas, mueve bytes y devuelve rutas, igual
//! que `archivo`: quien tenga que dejar la base en un estado copiable lo hace
//! antes de llamar acá.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use crate::modelo::Error;

/// El archivo que tiene que estar dentro para que sea un respaldo nuestro.
///
/// Cualquier `.zip` se abre y se extrae sin quejarse, así que sin esta
/// comprobación un archivo cualquiera volcaba su contenido dentro de la carpeta
/// de datos del usuario. No fallaba: hacía algo que nadie pidió.
const SEÑA: &str = "calendario.db";

/// Dónde espera un respaldo hasta el próximo arranque.
///
/// Vive dentro de la carpeta de datos y no en el temporal del sistema: si el
/// equipo se apaga entre confirmar y volver a abrir, el respaldo sigue ahí.
const PREPARADO: &str = "_restaurar";

fn error(que: impl std::fmt::Display) -> Error {
    Error::Archivo(que.to_string())
}

/// Empaqueta la carpeta de datos en un archivo.
///
/// `destino` puede estar dentro de la propia carpeta —nada se lo impide al
/// usuario—, así que se salta a sí mismo: sin eso, el archivo intentaría
/// contenerse y crecería mientras se escribe.
pub fn empaquetar(carpeta: &Path, destino: &Path) -> Result<(), Error> {
    let archivo = fs::File::create(destino).map_err(error)?;
    let mut zip = zip::ZipWriter::new(archivo);
    let opciones = zip::write::SimpleFileOptions::default();

    for ruta in recorrer(carpeta)? {
        if ruta == destino {
            continue;
        }

        let relativa = ruta
            .strip_prefix(carpeta)
            .map_err(error)?
            .to_string_lossy()
            // Dentro del archivo las barras son siempre las normales, sea cual
            // sea el sistema que lo escribió.
            .replace('\\', "/");

        // Lo que quedó esperando de un intento anterior no entra al respaldo.
        if relativa.starts_with(PREPARADO) {
            continue;
        }

        zip.start_file(relativa, opciones).map_err(error)?;

        let mut origen = fs::File::open(&ruta).map_err(error)?;
        let mut bytes = Vec::new();
        origen.read_to_end(&mut bytes).map_err(error)?;
        zip.write_all(&bytes).map_err(error)?;
    }

    zip.finish().map_err(error)?;
    Ok(())
}

/// Todos los archivos de la carpeta, en cualquier nivel.
fn recorrer(carpeta: &Path) -> Result<Vec<PathBuf>, Error> {
    let mut encontrados = Vec::new();
    let mut pendientes = vec![carpeta.to_path_buf()];

    while let Some(actual) = pendientes.pop() {
        for entrada in fs::read_dir(&actual).map_err(error)? {
            let ruta = entrada.map_err(error)?.path();
            if ruta.is_dir() {
                pendientes.push(ruta);
            } else {
                encontrados.push(ruta);
            }
        }
    }

    Ok(encontrados)
}

/// Deja un respaldo listo para aplicarse en el próximo arranque.
///
/// No lo aplica: la base está abierta y su WAL todavía puede volcarse encima de
/// lo que se escriba ahora. Se extrae a un lado, y quien lo pone en su sitio es
/// `aplicar_si_hay`, antes de que nadie abra nada.
pub fn dejar_preparado(carpeta: &Path, origen: &Path) -> Result<(), Error> {
    let archivo = fs::File::open(origen).map_err(error)?;
    let mut zip = zip::ZipArchive::new(archivo)
        .map_err(|e| Error::Archivo(format!("el archivo no es un respaldo válido: {e}")))?;

    // Se comprueba antes de tocar nada: un archivo que no es un respaldo no
    // llega a borrar el que pudiera estar esperando ni a extraer nada.
    if zip.by_name(SEÑA).is_err() {
        return Err(Error::Archivo(
            "el archivo no es un respaldo de SwiftCalendar: no contiene la base de datos".into(),
        ));
    }

    let espera = carpeta.join(PREPARADO);

    // Lo que hubiera de un intento anterior se va: un respaldo a medias mezclado
    // con otro produce una carpeta que no es ninguno de los dos.
    if espera.exists() {
        fs::remove_dir_all(&espera).map_err(error)?;
    }
    fs::create_dir_all(&espera).map_err(error)?;

    zip.extract(&espera).map_err(error)?;
    Ok(())
}

/// Aplica el respaldo que hubiera quedado esperando, y devuelve si aplicó alguno.
///
/// Corre antes de abrir la base, que es el único momento en que los archivos no
/// están en uso. Si algo falla a mitad, la carpeta de espera se queda y el
/// próximo arranque lo vuelve a intentar.
pub fn aplicar_si_hay(carpeta: &Path) -> Result<bool, Error> {
    let espera = carpeta.join(PREPARADO);
    if !espera.is_dir() {
        return Ok(false);
    }

    for ruta in recorrer(&espera)? {
        let relativa = ruta.strip_prefix(&espera).map_err(error)?;
        let destino = carpeta.join(relativa);

        if let Some(padre) = destino.parent() {
            fs::create_dir_all(padre).map_err(error)?;
        }
        fs::copy(&ruta, &destino).map_err(error)?;
    }

    fs::remove_dir_all(&espera).map_err(error)?;
    Ok(true)
}
