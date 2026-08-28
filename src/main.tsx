import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { MenuBandeja } from "./MenuBandeja";
import "./estilos.css";

/*
 * Qué ventana es esta.
 *
 * El menú de la bandeja es una ventana aparte que carga el mismo `index.html`
 * con un parámetro. Se decide acá y no dentro de `App` para que la ventana del
 * menú no monte el calendario entero: son tres entradas, y no necesita ni
 * estado, ni consultas, ni atajos.
 */
const parametros = new URLSearchParams(window.location.search);
const esMenuDeBandeja = parametros.get("ventana") === "bandeja";

/*
 * Los dos atributos de la ventana del menú se ponen antes de dibujar.
 *
 * El de la ventana, porque el menú no tiene fondo —el suyo lo dibuja la caja,
 * con sus esquinas— y un cuadro opaco en el primer fotograma se ve. El del
 * tema, porque quien lo marca en el calendario es `App`, que acá no se monta:
 * sin esto el menú nacería con la paleta oscura aunque el tema sea el claro.
 */
if (esMenuDeBandeja) {
  document.documentElement.dataset.ventana = "bandeja";
  document.documentElement.dataset.tema = parametros.get("tema") ?? "oscuro";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{esMenuDeBandeja ? <MenuBandeja /> : <App />}</React.StrictMode>,
);
