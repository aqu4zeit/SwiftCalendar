import { Fragment, useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

import {
  elegirDelMenu,
  menuDeBandeja,
  REARMAR,
  type EntradaBandeja,
} from "./api";

/**
 * El menú del ícono de la bandeja.
 *
 * Vive en su propia ventana, sin decoración y transparente, anclada sobre el
 * ícono por el lado nativo. Dibuja lo mismo que el menú del clic derecho del
 * calendario —`.menu-contextual`, sus medidas y su paleta— porque es el mismo
 * control, y la única razón de que hasta ahora no lo pareciera era que lo
 * dibujaba Windows.
 *
 * No sabe qué entradas hay ni qué hacen: las recibe armadas y devuelve el
 * identificador de la que se apretó, igual que `MenuContextual`. Es lo que va a
 * permitir que un complemento agregue las suyas sin tocar esta pantalla.
 *
 * La ventana no se destruye al cerrarse, así que este componente se monta una
 * sola vez: la lista se vuelve a pedir cada vez que el menú despierta.
 */
export function MenuBandeja() {
  const [entradas, setEntradas] = useState<EntradaBandeja[]>([]);

  const armar = useCallback(() => {
    menuDeBandeja()
      .then(({ tema, entradas }) => {
        // El tema se marca en la raíz igual que en la ventana del calendario,
        // que es lo que hace que las 42 variables de color cambien de golpe.
        document.documentElement.dataset.tema = tema;
        setEntradas(entradas);
      })
      .catch(() => {
        // Un menú que no aparece por no poder armarse sería peor que uno corto.
        // El lado nativo sigue atendiendo el clic izquierdo del ícono.
      });
  }, []);

  useEffect(armar, [armar]);

  // Cada vez que el menú vuelve a abrirse, el lado nativo avisa: el dibujo es el
  // de la vez anterior y la cuenta de recordatorios pudo cambiar.
  useEffect(() => {
    const quitar = listen(REARMAR, armar);

    return () => void quitar.then((f) => f());
  }, [armar]);

  // Escape lo cierra, como cualquier menú. El clic fuera lo cierra el lado
  // nativo al perder el foco, que es donde se sabe si cayó sobre el ícono.
  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") void elegirDelMenu("cerrar");
    }

    document.addEventListener("keydown", tecla);
    return () => document.removeEventListener("keydown", tecla);
  }, []);

  return (
    <div className="menu-contextual anclado">
      {entradas.map((entrada) => (
        <Fragment key={entrada.id}>
          {entrada.separada && <div className="raya-menu" />}

          <button
            type="button"
            className={entrada.malo ? "opcion-menu mala" : "opcion-menu"}
            onClick={() => void elegirDelMenu(entrada.id)}
          >
            <span className="txt-menu">
              {entrada.marca && <i className="punto-menu" />}
              {entrada.texto}
            </span>
          </button>
        </Fragment>
      ))}
    </div>
  );
}
