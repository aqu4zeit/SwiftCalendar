//! Copia de archivos a la carpeta de datos.
//!
//! Nada de lo que hay acá toca la base. Este módulo solo mueve bytes y devuelve
//! rutas relativas a la raíz de la carpeta, que es lo único que se guarda.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use image::{DynamicImage, ImageFormat};

use crate::modelo::{Adjunto, Error, Imagen, Recorte};

/// Lado mayor del original al copiarlo. Decisión 52.
const LADO_ORIGINAL: u32 = 1920;

/// Lado mayor de la miniatura. Decisión 52.
const LADO_MINIATURA: u32 = 320;

/// Lado mayor de la vista que se usa para elegir el encuadre.
///
/// No es el archivo: es lo que se dibuja para poder mover el marco encima. Que
/// sea chica es el punto, porque la imagen elegida puede pesar cientos de megas
/// y la interfaz no tiene por qué cargarla entera para recortarla.
const LADO_VISTA: u32 = 900;

/// Calidad del JPEG. Suficiente para una foto en pantalla, sin engordar el
/// archivo `.calev`, donde la imagen viaja codificada.
const CALIDAD_JPEG: u8 = 85;

/// Lo máximo que puede pesar un archivo que entra a la carpeta de datos.
///
/// La carpeta se respalda entera en un solo comprimido, y la copia bloquea la
/// interfaz sin barra de progreso.
const MAXIMO_BYTES: u64 = 500 * 1024 * 1024;

/// Lo máximo que puede medir una imagen, en píxeles totales.
///
/// El peso del archivo no dice cuánta memoria pide abrirlo: un JPEG comprime
/// tanto que medio giga en disco puede ser una imagen de cientos de millones de
/// píxeles, y descomprimirla ocupa cuatro bytes por cada uno. `image::open`
/// descomprime entera antes de encoger, así que sin este tope una imagen
/// extrema cierra la aplicación en vez de dar un error. A cuatro bytes por
/// píxel, esto son unos 600 MB de memoria en el peor caso.
const MAXIMO_PIXELES: u64 = 150_000_000;

/// La carpeta de datos, guardada como estado de la aplicación.
pub struct Carpeta(pub PathBuf);

fn falla(que: &str, e: impl std::fmt::Display) -> Error {
    Error::Archivo(format!("{que}: {e}"))
}

/// Un nombre que no puede chocar con otro, con la extensión pedida.
///
/// No conserva el nombre original: dos archivos que se llamen igual tienen que
/// poder convivir, y el nombre para mostrar se guarda aparte en la base. Sin
/// extensión no lleva punto: un adjunto puede no tenerla.
fn nombre_unico(extension: Option<&str>) -> String {
    let marca = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("el reloj del sistema está antes de 1970")
        .as_nanos();

    match extension {
        Some(e) => format!("{marca}.{e}"),
        None => marca.to_string(),
    }
}

/// Cuánto pesa el archivo, o un error si no se puede saber.
///
/// Se pregunta antes de leer el contenido: es una llamada al sistema y no abre
/// el archivo. Un archivo que no cabe falla sin haber copiado ni decodificado
/// nada.
fn comprobar_peso(origen: &Path) -> Result<u64, Error> {
    let bytes = std::fs::metadata(origen)
        .map_err(|e| falla(&format!("no se pudo leer {}", origen.display()), e))?
        .len();

    if bytes > MAXIMO_BYTES {
        return Err(Error::Archivo(format!(
            "«{}» pesa {} y el máximo son {}",
            nombre_de(origen)?,
            en_megas(bytes),
            en_megas(MAXIMO_BYTES)
        )));
    }

    Ok(bytes)
}

/// El nombre del archivo tal como lo ve el usuario.
fn nombre_de(origen: &Path) -> Result<String, Error> {
    origen
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.to_string())
        .ok_or_else(|| Error::Archivo(format!("{} no nombra un archivo", origen.display())))
}

fn en_megas(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
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

/// Se queda con la parte pedida de la imagen. Sin recorte, la deja igual.
///
/// El rectángulo llega en fracciones y se convierte acá: es el único sitio que
/// conoce las medidas reales del archivo.
fn recortar(imagen: &DynamicImage, recorte: Option<Recorte>) -> DynamicImage {
    let Some(r) = recorte else {
        return imagen.clone();
    };

    let ancho = imagen.width() as f32;
    let alto = imagen.height() as f32;

    // Un rectángulo de cero píxeles no es una imagen. Redondear hacia abajo
    // puede producirlo cuando el marco queda muy fino.
    let w = ((r.ancho * ancho).round() as u32).max(1).min(imagen.width());
    let h = ((r.alto * alto).round() as u32).max(1).min(imagen.height());
    let x = ((r.x * ancho).round() as u32).min(imagen.width() - w);
    let y = ((r.y * alto).round() as u32).min(imagen.height() - h);

    imagen.crop_imm(x, y, w, h)
}

/// Una versión reducida de la imagen, para elegir el encuadre antes de guardarla.
///
/// Vuelve como texto porque el archivo elegido está fuera de la carpeta de datos
/// y el protocolo de archivos no lo sirve. Abrirle el alcance a todo el disco
/// para esto sería un permiso permanente por una vista temporal.
pub fn vista_previa(origen: &Path) -> Result<String, Error> {
    comprobar_peso(origen)?;
    comprobar_pixeles(origen)?;

    let imagen = image::open(origen)
        .map_err(|e| falla(&format!("no se pudo leer {}", origen.display()), e))?;

    let reducida = ajustar(&imagen, LADO_VISTA);
    let mut bytes: Vec<u8> = Vec::new();

    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, CALIDAD_JPEG)
        .encode_image(&reducida.to_rgb8())
        .map_err(|e| falla("no se pudo preparar la vista previa", e))?;

    Ok(format!("data:image/jpeg;base64,{}", base64(&bytes)))
}

/// Codifica en base64 sin traer una dependencia por veinte líneas.
fn base64(bytes: &[u8]) -> String {
    const ALFABETO: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    let mut salida = String::with_capacity(bytes.len().div_ceil(3) * 4);

    for grupo in bytes.chunks(3) {
        let b = [grupo[0], *grupo.get(1).unwrap_or(&0), *grupo.get(2).unwrap_or(&0)];
        let junto = u32::from(b[0]) << 16 | u32::from(b[1]) << 8 | u32::from(b[2]);

        for i in 0..4 {
            if i <= grupo.len() {
                let indice = (junto >> (18 - i * 6)) & 0b11_1111;
                salida.push(ALFABETO[indice as usize] as char);
            } else {
                salida.push('=');
            }
        }
    }

    salida
}

/// Copia una imagen a la carpeta de datos y genera su miniatura.
///
/// Devuelve las dos rutas, relativas a la raíz de la carpeta. Van siempre
/// juntas: el esquema no acepta una sin la otra.
pub fn guardar_imagen(
    carpeta: &Path,
    origen: &Path,
    recorte: Option<Recorte>,
) -> Result<Imagen, Error> {
    comprobar_peso(origen)?;
    comprobar_pixeles(origen)?;

    let entera = image::open(origen)
        .map_err(|e| falla(&format!("no se pudo leer {}", origen.display()), e))?;

    let imagen = recortar(&entera, recorte);
    let con_alfa = imagen.color().has_alpha();
    let extension = Some(if con_alfa { "png" } else { "jpg" });

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

/// Cuántos píxeles mide la imagen, leídos de la cabecera.
///
/// Preguntar el tamaño no decodifica el contenido, así que una imagen que no
/// cabe en memoria se rechaza sin haberla cargado.
fn comprobar_pixeles(origen: &Path) -> Result<(), Error> {
    let (ancho, alto) = image::image_dimensions(origen)
        .map_err(|e| falla(&format!("no se pudo leer {}", origen.display()), e))?;

    let total = u64::from(ancho) * u64::from(alto);
    if total > MAXIMO_PIXELES {
        return Err(Error::Archivo(format!(
            "«{}» mide {ancho}×{alto} y el máximo son {} megapíxeles",
            nombre_de(origen)?,
            MAXIMO_PIXELES / 1_000_000
        )));
    }

    Ok(())
}

/// Copia un archivo a la carpeta de datos tal cual.
///
/// A diferencia de la imagen, el contenido no se toca: un adjunto se abre después
/// con el programa que le corresponda, y para eso conserva su extensión.
pub fn guardar_adjunto(carpeta: &Path, origen: &Path) -> Result<Adjunto, Error> {
    let tamano = comprobar_peso(origen)?;
    let nombre_original = nombre_de(origen)?;

    let extension = origen.extension().and_then(|e| e.to_str());
    let ruta = format!("assets/adjuntos/{}", nombre_unico(extension));

    std::fs::copy(origen, carpeta.join(&ruta))
        .map_err(|e| falla(&format!("no se pudo copiar «{nombre_original}»"), e))?;

    Ok(Adjunto {
        ruta,
        nombre_original,
        tamano: tamano as i64,
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

        let imagen = guardar_imagen(&carpeta, &origen, None).unwrap();

        assert_eq!(medir(&carpeta, &imagen.original), (1920, 1280));
        assert_eq!(medir(&carpeta, &imagen.miniatura), (320, 213));
    }

    /// Una imagen que ya cabe no se toca: encogerla y agrandarla la degradaría.
    #[test]
    fn una_imagen_chica_conserva_su_tamano() {
        let carpeta = carpeta_temporal("chica");
        let origen = foto(&carpeta, 400, 250);

        let imagen = guardar_imagen(&carpeta, &origen, None).unwrap();

        assert_eq!(medir(&carpeta, &imagen.original), (400, 250));
        assert_eq!(medir(&carpeta, &imagen.miniatura), (320, 200));
    }

    /// El lado mayor manda, sea el ancho o el alto.
    #[test]
    fn el_lado_mayor_es_el_que_se_limita() {
        let carpeta = carpeta_temporal("vertical");
        let origen = foto(&carpeta, 1000, 4000);

        let imagen = guardar_imagen(&carpeta, &origen, None).unwrap();

        assert_eq!(medir(&carpeta, &imagen.original), (480, 1920));
        assert_eq!(medir(&carpeta, &imagen.miniatura), (80, 320));
    }

    /// Con transparencia se guarda en PNG, que la conserva.
    #[test]
    fn una_imagen_con_transparencia_se_guarda_en_png() {
        let carpeta = carpeta_temporal("alfa");
        let origen = con_transparencia(&carpeta, 500);

        let imagen = guardar_imagen(&carpeta, &origen, None).unwrap();

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

        let imagen = guardar_imagen(&carpeta, &origen, None).unwrap();

        assert!(imagen.original.ends_with(".jpg"));
        assert!(imagen.miniatura.ends_with(".jpg"));
    }

    /// El original y la miniatura nunca comparten nombre.
    #[test]
    fn el_original_y_la_miniatura_son_archivos_distintos() {
        let carpeta = carpeta_temporal("nombres");
        let origen = foto(&carpeta, 600, 600);

        let imagen = guardar_imagen(&carpeta, &origen, None).unwrap();

        assert_ne!(imagen.original, imagen.miniatura);
        assert!(existe(&carpeta, &imagen.original));
        assert!(existe(&carpeta, &imagen.miniatura));
    }

    /// Dos imágenes seguidas no se pisan.
    #[test]
    fn dos_imagenes_no_se_pisan() {
        let carpeta = carpeta_temporal("dos");
        let origen = foto(&carpeta, 300, 300);

        let una = guardar_imagen(&carpeta, &origen, None).unwrap();
        let otra = guardar_imagen(&carpeta, &origen, None).unwrap();

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
            guardar_imagen(&carpeta, &ruta, None),
            Err(Error::Archivo(_))
        ));
    }

    /// Un archivo borrado a mano se detecta en vez de dibujarse como un hueco.
    #[test]
    fn una_imagen_borrada_a_mano_deja_de_existir() {
        let carpeta = carpeta_temporal("borrada");
        let origen = foto(&carpeta, 300, 300);
        let imagen = guardar_imagen(&carpeta, &origen, None).unwrap();

        std::fs::remove_file(carpeta.join(&imagen.original)).unwrap();

        assert!(!existe(&carpeta, &imagen.original));
        assert!(existe(&carpeta, &imagen.miniatura));
    }

    /// Recortar la mitad de cada lado deja un cuarto de la imagen.
    #[test]
    fn el_recorte_se_aplica_antes_de_encoger() {
        let carpeta = carpeta_temporal("recorte");
        let origen = foto(&carpeta, 800, 400);

        let imagen = guardar_imagen(
            &carpeta,
            &origen,
            Some(Recorte { x: 0.0, y: 0.0, ancho: 0.5, alto: 0.5 }),
        )
        .unwrap();

        assert_eq!(medir(&carpeta, &imagen.original), (400, 200));
    }

    /// Sin recorte la imagen sale igual que antes de que el recorte existiera.
    #[test]
    fn sin_recorte_la_imagen_no_cambia() {
        let carpeta = carpeta_temporal("sin-recorte");
        let origen = foto(&carpeta, 800, 400);

        let imagen = guardar_imagen(&carpeta, &origen, None).unwrap();

        assert_eq!(medir(&carpeta, &imagen.original), (800, 400));
    }

    /// Un marco muy fino no puede producir una imagen de cero píxeles.
    #[test]
    fn un_recorte_diminuto_deja_al_menos_un_pixel() {
        let carpeta = carpeta_temporal("fino");
        let origen = foto(&carpeta, 600, 600);

        let imagen = guardar_imagen(
            &carpeta,
            &origen,
            Some(Recorte { x: 0.5, y: 0.5, ancho: 0.0, alto: 0.0 }),
        )
        .unwrap();

        assert_eq!(medir(&carpeta, &imagen.original), (1, 1));
    }

    /// Un marco pegado al borde no se sale de la imagen.
    #[test]
    fn un_recorte_en_el_borde_no_se_pasa() {
        let carpeta = carpeta_temporal("borde");
        let origen = foto(&carpeta, 400, 300);

        let imagen = guardar_imagen(
            &carpeta,
            &origen,
            Some(Recorte { x: 0.9, y: 0.9, ancho: 0.5, alto: 0.5 }),
        )
        .unwrap();

        let (ancho, alto) = medir(&carpeta, &imagen.original);
        assert!(ancho <= 400 && alto <= 300, "cabe dentro: {ancho}x{alto}");
    }

    /// La vista previa se reduce y vuelve como texto que el navegador entiende.
    #[test]
    fn la_vista_previa_es_una_imagen_reducida() {
        let carpeta = carpeta_temporal("vista");
        let origen = foto(&carpeta, 3000, 1500);

        let texto = vista_previa(&origen).unwrap();

        assert!(texto.starts_with("data:image/jpeg;base64,"));
        assert!(texto.len() > 100, "trae contenido");
    }

    /// Una imagen que no cabe se rechaza al elegirla, no al guardarla.
    #[test]
    fn la_vista_previa_comprueba_los_limites() {
        let carpeta = carpeta_temporal("vista-mala");
        let ruta = carpeta.join("no-es-imagen.jpg");
        std::fs::write(&ruta, b"esto no es una imagen").unwrap();

        assert!(matches!(vista_previa(&ruta), Err(Error::Archivo(_))));
    }

    /// Los tres restos posibles al dividir en grupos de tres bytes.
    #[test]
    fn base64_rellena_bien_los_grupos_incompletos() {
        assert_eq!(base64(b"abc"), "YWJj");
        assert_eq!(base64(b"ab"), "YWI=");
        assert_eq!(base64(b"a"), "YQ==");
        assert_eq!(base64(b""), "");
        assert_eq!(base64(&[255, 255, 255]), "////");
        assert_eq!(base64(&[0, 0, 0]), "AAAA");
    }

    /// Un archivo cualquiera con el contenido pedido.
    fn archivo(carpeta: &Path, nombre: &str, bytes: usize) -> PathBuf {
        let ruta = carpeta.join(nombre);
        std::fs::write(&ruta, vec![b'x'; bytes]).unwrap();
        ruta
    }

    /// El adjunto se copia entero y sin tocarle el contenido.
    #[test]
    fn un_adjunto_se_copia_tal_cual() {
        let carpeta = carpeta_temporal("adjunto");
        let origen = archivo(&carpeta, "rubrica.pdf", 2048);

        let adjunto = guardar_adjunto(&carpeta, &origen).unwrap();

        assert_eq!(adjunto.nombre_original, "rubrica.pdf");
        assert_eq!(adjunto.tamano, 2048);
        assert!(existe(&carpeta, &adjunto.ruta));
        assert_eq!(
            std::fs::read(carpeta.join(&adjunto.ruta)).unwrap(),
            std::fs::read(&origen).unwrap()
        );
    }

    /// La extensión se conserva: es lo que le dice a Windows con qué abrirlo.
    #[test]
    fn un_adjunto_conserva_su_extension() {
        let carpeta = carpeta_temporal("extension");
        let origen = archivo(&carpeta, "planilla.xlsx", 16);

        let adjunto = guardar_adjunto(&carpeta, &origen).unwrap();

        assert!(adjunto.ruta.ends_with(".xlsx"));
        assert!(adjunto.ruta.starts_with("assets/adjuntos/"));
    }

    /// El nombre guardado no es el original: dos archivos iguales conviven.
    #[test]
    fn dos_adjuntos_con_el_mismo_nombre_conviven() {
        let carpeta = carpeta_temporal("homonimos");
        let origen = archivo(&carpeta, "notas.txt", 8);

        let uno = guardar_adjunto(&carpeta, &origen).unwrap();
        let otro = guardar_adjunto(&carpeta, &origen).unwrap();

        assert_ne!(uno.ruta, otro.ruta);
        assert_eq!(uno.nombre_original, otro.nombre_original);
        assert!(existe(&carpeta, &uno.ruta));
        assert!(existe(&carpeta, &otro.ruta));
    }

    /// Sin extensión el nombre guardado no lleva punto suelto.
    #[test]
    fn un_adjunto_sin_extension_se_guarda_igual() {
        let carpeta = carpeta_temporal("sin-extension");
        let origen = archivo(&carpeta, "LEEME", 4);

        let adjunto = guardar_adjunto(&carpeta, &origen).unwrap();

        assert!(!adjunto.ruta.ends_with('.'));
        assert_eq!(adjunto.nombre_original, "LEEME");
        assert!(existe(&carpeta, &adjunto.ruta));
    }

    /// El peso se comprueba antes de copiar: nada entra a la carpeta.
    #[test]
    fn un_archivo_demasiado_pesado_no_se_copia() {
        let carpeta = carpeta_temporal("pesado");
        let origen = carpeta.join("enorme.bin");

        // Un archivo disperso: ocupa el tamaño declarado sin escribir los bytes.
        let f = std::fs::File::create(&origen).unwrap();
        f.set_len(MAXIMO_BYTES + 1).unwrap();
        drop(f);

        assert!(matches!(
            guardar_adjunto(&carpeta, &origen),
            Err(Error::Archivo(_))
        ));

        let copiados = std::fs::read_dir(carpeta.join("assets/adjuntos"))
            .unwrap()
            .count();
        assert_eq!(copiados, 0, "no alcanzó a copiar nada");
    }

    /// El límite de píxeles se comprueba en la cabecera, sin decodificar.
    #[test]
    fn una_imagen_con_demasiados_pixeles_se_rechaza() {
        let carpeta = carpeta_temporal("gigante");
        let ruta = carpeta.join("gigante.png");

        // Un PNG que declara 20000×20000 y no trae ni un píxel. Decodificarlo
        // pediría 1,6 GB de memoria; leer sus medidas no cuesta nada.
        //
        // Los tres chunks van completos y con su CRC. El lector recorre hasta
        // IDAT antes de entregar las medidas, así que un archivo cortado en
        // IHDR falla por final inesperado y la prueba pasaría sin haber medido
        // nada.
        let mut png: Vec<u8> = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&20000u32.to_be_bytes());
        png.extend_from_slice(&20000u32.to_be_bytes());
        png.extend_from_slice(&[8, 2, 0, 0, 0]);
        png.extend_from_slice(&0x6c12_d16e_u32.to_be_bytes());

        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IDAT");
        png.extend_from_slice(&0x35af_061e_u32.to_be_bytes());

        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&0xae42_6082_u32.to_be_bytes());

        std::fs::write(&ruta, png).unwrap();

        let error = guardar_imagen(&carpeta, &ruta, None).unwrap_err();
        let Error::Archivo(texto) = error else {
            panic!("el error tiene que ser de archivo");
        };
        assert!(texto.contains("megapíxeles"), "rechazada por el tamaño: {texto}");
    }
}
