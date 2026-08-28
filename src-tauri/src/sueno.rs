//! Dormir y despertar el webview de una ventana escondida.
//!
//! Lo usa el menú de la bandeja. Crear la ventana cuesta levantar un webview
//! entero —seis procesos medidos en la etapa 14—, así que el menú se crea una
//! sola vez y después se esconde en vez de destruirse. Escondido no dibuja nada,
//! pero seguiría consumiendo como si dibujara: suspenderlo pausa sus
//! temporizadores, baja el uso de CPU del proceso que dibuja y deja que el
//! sistema reutilice su memoria.
//!
//! WebView2 lo reanuda solo al hacerse visible. `reanudar` está igual para que
//! el primer fotograma no sea el de un webview dormido.
//!
//! Si el equipo tiene un WebView2 anterior a la versión que trae la API, no pasa
//! nada: el menú queda escondido y despierto, que es como estaría sin este
//! archivo. No es un camino alternativo, es que ahí no hay nada que suspender.

use tauri::{Runtime, WebviewWindow};

/// Esconde el webview y lo suspende.
///
/// La condición que pone Microsoft es que no esté visible: con el webview a la
/// vista, `TrySuspend` falla con `ERROR_INVALID_STATE`. Por eso lo primero es
/// apagar su visibilidad, que es distinto de esconder la ventana.
#[cfg(windows)]
pub fn suspender<R: Runtime>(ventana: &WebviewWindow<R>) -> tauri::Result<()> {
    ventana.with_webview(|plataforma| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use webview2_com::TrySuspendCompletedHandler;
        use windows_core::Interface;

        let controlador = plataforma.controller();
        if controlador.SetIsVisible(false).is_err() {
            return;
        }

        let Ok(webview) = controlador.CoreWebView2() else {
            return;
        };
        let Ok(suspendible) = webview.cast::<ICoreWebView2_3>() else {
            return;
        };

        let manejador = TrySuspendCompletedHandler::create(Box::new(|resultado, _| resultado));
        let _ = suspendible.TrySuspend(&manejador);
    })
}

/// Lo devuelve a la vida antes de mostrarlo.
#[cfg(windows)]
pub fn reanudar<R: Runtime>(ventana: &WebviewWindow<R>) -> tauri::Result<()> {
    ventana.with_webview(|plataforma| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use windows_core::Interface;

        let controlador = plataforma.controller();

        if let Ok(webview) = controlador.CoreWebView2() {
            if let Ok(suspendible) = webview.cast::<ICoreWebView2_3>() {
                let _ = suspendible.Resume();
            }
        }

        let _ = controlador.SetIsVisible(true);
    })
}

/// Fuera de Windows no hay nada que suspender. El proyecto es de Windows; esto
/// existe para que el resto del archivo no tenga que preguntarlo.
#[cfg(not(windows))]
pub fn suspender<R: Runtime>(_ventana: &WebviewWindow<R>) -> tauri::Result<()> {
    Ok(())
}

#[cfg(not(windows))]
pub fn reanudar<R: Runtime>(_ventana: &WebviewWindow<R>) -> tauri::Result<()> {
    Ok(())
}
