import { useEffect, useState } from "react";

import { BotonBorrar } from "./BotonBorrar";
import { aNumerica, desdeNumerica, mascaraFecha } from "./fecha";
import { useFlotante } from "./flotante";
import { MiniCalendario } from "./MiniCalendario";

/** Alto del calendario, para saber si cabe debajo del campo. */
const ALTO_CALENDARIO = 268;

interface Props {
  /** La fecha en `AAAA-MM-DD`, o vacío. */
  valor: string;
  onCambiar: (iso: string) => void;
  placeholder?: string;
}

/** Un campo de fecha que se escribe a mano y también se elige del calendario. */
export function CampoFecha({ valor, onCambiar, placeholder }: Props) {
  const [texto, setTexto] = useState(valor ? aNumerica(valor) : "");
  const { ancla, panel, posicion, abierto, saliendo, abrir, cerrar } =
    useFlotante(ALTO_CALENDARIO);

  // El valor puede cambiar desde afuera, por ejemplo al elegir en el calendario.
  useEffect(() => {
    setTexto(valor ? aNumerica(valor) : "");
  }, [valor]);

  function escribir(crudo: string) {
    const limpio = mascaraFecha(crudo);
    setTexto(limpio);

    if (limpio === "") {
      onCambiar("");
      return;
    }

    const iso = desdeNumerica(limpio);
    if (iso) onCambiar(iso);
  }

  const invalido = texto !== "" && desdeNumerica(texto) === null;

  return (
    <div className="campo-fecha" ref={ancla}>
      <div className={invalido ? "campo malo" : "campo"}>
        <input
          type="text"
          inputMode="numeric"
          value={texto}
          placeholder={placeholder ?? "DD/MM/AAAA"}
          onChange={(e) => escribir(e.target.value)}
        />
        {texto !== "" && (
          <BotonBorrar
            onBorrar={() => {
              setTexto("");
              onCambiar("");
            }}
          />
        )}
        <button
          type="button"
          className="icono-cal"
          onClick={() => (abierto ? cerrar() : abrir())}
          title="Elegir del calendario"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
        </button>
      </div>

      {posicion && (
        <div
          className={saliendo ? "flotante saliendo" : "flotante"}
          ref={panel}
          style={{ top: posicion.top, left: posicion.left }}
        >
          <MiniCalendario
            valor={valor}
            onElegir={(iso) => {
              onCambiar(iso);
              cerrar();
            }}
          />
        </div>
      )}
    </div>
  );
}
