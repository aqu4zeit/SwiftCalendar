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
const esMenuDeBandeja =
  new URLSearchParams(window.location.search).get("ventana") === "bandeja";

// La ventana del menú no tiene fondo: el suyo lo dibuja la caja, con sus
// esquinas. El atributo se pone antes de dibujar para que no haya un cuadro
// opaco en el primer fotograma.
if (esMenuDeBandeja) document.documentElement.dataset.ventana = "bandeja";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{esMenuDeBandeja ? <MenuBandeja /> : <App />}</React.StrictMode>,
);
