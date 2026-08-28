//! El tema de lo que dibuja Windows.
//!
//! PROTOTIPO DE LA INVESTIGACIÓN.
//!
//! Es la excepción a la regla de que nada de Windows dibuja nuestra interfaz. El
//! popup del ícono de la bandeja sale por `TrackPopupMenu` y no acepta estilo,
//! que es lo que dice la decisión 102. Lo único que sí acepta es el modo claro u
//! oscuro del sistema, y eso se enciende por ordinal en `uxtheme.dll`.
//!
//! `tao` ya deja puesto `AllowDark` al crear el bucle de eventos, que significa
//! "oscuro si Windows lo está". Acá se sube a forzado, para que el menú siga el
//! tema que el usuario eligió en la aplicación y no el del equipo. De paso lo
//! siguen los diálogos del sistema: el de elegir imagen y el del respaldo.
//!
//! Los ordinales no están documentados por Microsoft. El proyecto ya depende de
//! ellos sin saberlo: `tao` usa el 132, el 133, el 135 y el 104, y `muda` el 132.
//! Agregar el 136 no cambia la clase de riesgo, y si un día dejan de existir,
//! `GetProcAddress` devuelve `None` y todo sigue como hoy.

/// Aplica el tema de la aplicación a lo que dibuja el sistema.
///
/// En cualquier sistema que no sea Windows no hay nada que hacer.
#[cfg(not(windows))]
pub fn aplicar(_oscuro: bool) {}

#[cfg(windows)]
pub fn aplicar(oscuro: bool) {
    use std::ffi::c_void;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryA};

    /// Qué modo quiere la aplicación. Los valores son los de `uxtheme.dll`.
    #[repr(C)]
    enum ModoPreferido {
        // Default = 0 y AllowDark = 1 no se usan: `tao` ya deja AllowDark, y lo
        // que hace falta acá es forzar, no permitir.
        ForzarOscuro = 2,
        ForzarClaro = 3,
    }

    type SetPreferredAppMode = unsafe extern "system" fn(ModoPreferido) -> ModoPreferido;
    type FlushMenuThemes = unsafe extern "system" fn();

    // El nombre de la función no está exportado: se pide por su número. Es lo
    // que hace `MAKEINTRESOURCEA` en C.
    const SET_PREFERRED_APP_MODE: u16 = 135;
    const FLUSH_MENU_THEMES: u16 = 136;

    unsafe {
        let uxtheme = LoadLibraryA(c"uxtheme.dll".as_ptr() as *const u8);
        if uxtheme.is_null() {
            return;
        }

        let por_ordinal =
            |ordinal: u16| GetProcAddress(uxtheme as *mut c_void, ordinal as usize as *const u8);

        if let Some(puntero) = por_ordinal(SET_PREFERRED_APP_MODE) {
            let poner: SetPreferredAppMode = std::mem::transmute(puntero);
            poner(if oscuro {
                ModoPreferido::ForzarOscuro
            } else {
                ModoPreferido::ForzarClaro
            });
        }

        // Sin esto, los menús que ya existen conservan el tema con el que
        // nacieron: el cambio se vería recién al reiniciar.
        if let Some(puntero) = por_ordinal(FLUSH_MENU_THEMES) {
            let refrescar: FlushMenuThemes = std::mem::transmute(puntero);
            refrescar();
        }
    }
}
