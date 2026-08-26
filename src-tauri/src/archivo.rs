//! Copia de archivos a la carpeta de datos.
//!
//! Nada de lo que hay acá toca la base. Este módulo solo mueve bytes y devuelve
//! rutas relativas a la raíz de la carpeta, que es lo único que se guarda.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use image::{DynamicImage, ImageFormat};

use crate::modelo::{Error, Imagen};

/// Lado mayor del original al copiarlo. Decisión 52.
const LADO_ORIGINAL: u32 = 1920;

/// Lado mayor de la miniatura. Decisión 52.
const LADO_MINIATURA: u32 = 320;

/// Calidad del JPEG. Suficiente para una foto en pantalla, sin engordar el
/// archivo `.calev`, donde la imagen viaja codificada.
const CALIDAD_JPEG: u8 = 85;

/// La carpeta de datos, guardada como estado de la aplicación.
pub struct Carpeta(pub PathBuf);

fn falla(que: &str, e: impl std::fmt::Display) -> Error {
    Error::Archivo(format!("{que}: {e}"))
}

/// Un nombre que no puede chocar con otro, con la extensión pedida.
///
/// No conserva el nombre original: dos archivos que se llamen igual tienen que
/// poder convivir, y el nombre para mostrar se guarda aparte en la base.
fn nombre_unico(extension: &str) -> String {
    let marca = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("el reloj del sistema está antes de 1970")
        .as_nanos();

    format!("{marca}.{extension}")
}

/// Encoge la imagen si su lado mayor pasa del límite. Si no, la deja igual.
fn ajustar(imagen: &DynamicImage, lado: u32) -> DynamicImage {
    if imagen.width() <= lado && imagen.height() <= lado {
        return imagen.clone();
    }

    imagen.resize(lado, lado, image::imageops::FilterType::Lanczos3)
}

/// Escribe una imagen conservando la transparencia solo si la había.
///
/// Es una sola pregunta resuelta en un solo lugar. Guardar todo en JPEG perdería
/// el fondo transparente de los PNG, y guardar todo en PNG dejaría fotos de 1920
/// píxeles pesando varios megas.
fn escribir(imagen: &DynamicImage, destino: &Path, con_alfa: bool) -> Result<(), Error> {
    if con_alfa {
        return imagen
            .to_rgba8()
            .save_with_format(destino, ImageFormat::Png)
            .map_err(|e| falla("no se pudo escribir el PNG", e));
    }

    let archivo = std::fs::File::create(destino)
        .map_err(|e| falla("no se pudo crear el archivo de imagen", e))?;

    image::codecs::jpeg::JpegEncoder::new_with_quality(archivo, CALIDAD_JPEG)
        .encode_image(&imagen.to_rgb8())
        .map_err(|e| falla("no se pudo escribir el JPEG", e))
}

/// Copia una imagen a la carpeta de datos y genera su miniatura.
///
/// Devuelve las dos rutas, relativas a la raíz de la carpeta. Van siempre
/// juntas: el esquema no acepta una sin la otra.
pub fn guardar_imagen(carpeta: &Path, origen: &Path) -> Result<Imagen, Error> {
    let imagen = image::open(origen)
        .map_err(|e| falla(&format!("no se pudo leer {}", origen.display()), e))?;

    let con_alfa = imagen.color().has_alpha();
    let extension = if con_alfa { "png" } else { "jpg" };

    let relativa_original = format!("assets/imagenes/{}", nombre_unico(extension));
    let relativa_miniatura = format!("assets/miniaturas/{}", nombre_unico(extension));

    escribir(&ajustar(&imagen, LADO_ORIGINAL), &carpeta.join(&relativa_original), con_alfa)?;
    escribir(
        &ajustar(&imagen, LADO_MINIATURA),
        &carpeta.join(&relativa_miniatura),
        con_alfa,
    )?;

    Ok(Imagen {
        original: relativa_original,
        miniatura: relativa_miniatura,
    })
}

/// Verdadero si el archivo sigue estando donde dice la base.
///
/// La carpeta es del usuario y puede vaciarla a mano. La ficha necesita poder
/// avisarlo en vez de dibujar un hueco sin explicación.
pub fn existe(carpeta: &Path, relativa: &str) -> bool {
    carpeta.join(relativa).is_file()
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use image::{Rgb, RgbImage, Rgba, RgbaImage};

    /// Una carpeta de datos vacía, con la estructura que crea el arranque.
    fn carpeta_temporal(nombre: &str) -> PathBuf {
        let raiz = std::env::temp_dir().join(format!("swiftcalendar-prueba-{nombre}"));
        let _ = std::fs::remove_dir_all(&raiz);

        for sub in ["assets/imagenes", "assets/miniaturas", "assets/adjuntos"] {
            std::fs::create_dir_all(raiz.join(sub)).unwrap();
        }

        raiz
    }

    fn foto(carpeta: &Path, ancho: u32, alto: u32) -> PathBuf {
        let ruta = carpeta.join("origen.jpg");
        let mut imagen = RgbImage::new(ancho, alto);
        for (x, y, pixel) in imagen.enumerate_pixels_mut() {
            *pixel = Rgb([(x % 256) as u8, (y % 256) as u8, 128]);
        }
        imagen.save(&ruta).unwrap();
        ruta
    }

    fn con_transparencia(carpeta: &Path, lado: u32) -> PathBuf {
        let ruta = carpeta.join("origen.png");
        let mut imagen = RgbaImage::new(lado, lado);
        for (x, _, pixel) in imagen.enumerate_pixels_mut() {
            *pixel = Rgba([200, 100, 50, if x < lado / 2 { 0 } else { 255 }]);
        }
        imagen.save(&ruta).unwrap();
        ruta
    }

    fn medir(carpeta: &Path, relativa: &str) -> (u32, u32) {
        let imagen = image::open(carpeta.join(relativa)).unwrap();
        (imagen.width(), imagen.height())
    }

    /// Una foto grande se recorta a 1920, y su miniatura a 320.
    #[test]
    fn una_imagen_grande_se_encoge_y_genera_miniatura() {
        let carpeta = carpeta_temporal("grande");
        let origen = foto(&carpeta, 3000, 2000);

        let imagen = guardar_imagen(&carpeta, &origen).unwrap();

        assert_eq!(medir(&carpeta, &imagen.original), (1920, 1280));
        assert_eq!(medir(&carpeta, &imagen.miniatura), (320, 213));
    }

    /// Una imagen que ya cabe no se toca: encogerla y agrandarla la degradaría.
    #[test]
    fn una_imagen_chica_conserva_su_tamano() {
        let carpeta = carpeta_temporal("chica");
        let origen = foto(&carpeta, 400, 250);

        let imagen = guardar_imagen(&carpeta, &origen).unwrap();

        assert_eq!(medir(&carpeta, &imagen.original), (400, 250));
        assert_eq!(medir(&carpeta, &imagen.miniatura), (320, 200));
    }

    /// El lado mayor manda, sea el ancho o el alto.
    #[test]
    fn el_lado_mayor_es_el_que_se_limita() {
        let carpeta = carpeta_temporal("vertical");
        let origen = foto(&carpeta, 1000, 4000);

        let imagen = guardar_imagen(&carpeta, &origen).unwrap();

        assert_eq!(medir(&carpeta, &imagen.original), (480, 1920));
        assert_eq!(medir(&carpeta, &imagen.miniatura), (80, 320));
    }

    /// Con transparencia se guarda en PNG, que la conserva.
    #[test]
    fn una_imagen_con_transparencia_se_guarda_en_png() {
        let carpeta = carpeta_temporal("alfa");
        let origen = con_transparencia(&carpeta, 500);

        let imagen = guardar_imagen(&carpeta, &origen).unwrap();

        assert!(imagen.original.ends_with(".png"));
        assert!(imagen.miniatura.ends_with(".png"));

        let guardada = image::open(carpeta.join(&imagen.original)).unwrap();
        assert!(guardada.color().has_alpha());
        assert_eq!(guardada.to_rgba8().get_pixel(10, 10)[3], 0, "sigue transparente");
    }

    /// Sin transparencia se guarda en JPEG, que pesa mucho menos.
    #[test]
    fn una_imagen_sin_transparencia_se_guarda_en_jpeg() {
        let carpeta = carpeta_temporal("jpeg");
        let origen = foto(&carpeta, 800, 600);

        let imagen = guardar_imagen(&carpeta, &origen).unwrap();

        assert!(imagen.original.ends_with(".jpg"));
        assert!(imagen.miniatura.ends_with(".jpg"));
    }

    /// El original y la miniatura nunca comparten nombre.
    #[test]
    fn el_original_y_la_miniatura_son_archivos_distintos() {
        let carpeta = carpeta_temporal("nombres");
        let origen = foto(&carpeta, 600, 600);

        let imagen = guardar_imagen(&carpeta, &origen).unwrap();

        assert_ne!(imagen.original, imagen.miniatura);
        assert!(existe(&carpeta, &imagen.original));
        assert!(existe(&carpeta, &imagen.miniatura));
    }

    /// Dos imágenes seguidas no se pisan.
    #[test]
    fn dos_imagenes_no_se_pisan() {
        let carpeta = carpeta_temporal("dos");
        let origen = foto(&carpeta, 300, 300);

        let una = guardar_imagen(&carpeta, &origen).unwrap();
        let otra = guardar_imagen(&carpeta, &origen).unwrap();

        assert_ne!(una.original, otra.original);
        assert!(existe(&carpeta, &una.original));
        assert!(existe(&carpeta, &otra.original));
    }

    /// Un archivo que no es una imagen falla con un error visible.
    #[test]
    fn un_archivo_que_no_es_imagen_falla() {
        let carpeta = carpeta_temporal("basura");
        let ruta = carpeta.join("no-es-imagen.jpg");
        std::fs::write(&ruta, b"esto no es una imagen").unwrap();

        assert!(matches!(
            guardar_imagen(&carpeta, &ruta),
            Err(Error::Archivo(_))
        ));
    }

    /// Un archivo borrado a mano se detecta en vez de dibujarse como un hueco.
    #[test]
    fn una_imagen_borrada_a_mano_deja_de_existir() {
        let carpeta = carpeta_temporal("borrada");
        let origen = foto(&carpeta, 300, 300);
        let imagen = guardar_imagen(&carpeta, &origen).unwrap();

        std::fs::remove_file(carpeta.join(&imagen.original)).unwrap();

        assert!(!existe(&carpeta, &imagen.original));
        assert!(existe(&carpeta, &imagen.miniatura));
    }
}
