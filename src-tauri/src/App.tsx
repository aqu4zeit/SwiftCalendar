import { useEffect, useState } from "react";

import {
  eventosEnRango,
  listarGrupos,
  TODAS_LAS_IMPORTANCIAS,
  type PorDia,
} from "./api";
import { clave, fechaLarga, mesYAnio, rejilla } from "./fecha";
import { VistaMes } from "./VistaMes";

/**
 * Hoy se calcula una vez al montar y no se refresca.
 *
 * Si la app pasa la medianoche abierta, la marca del día actual queda un día
 * atrasada. El temporizador que lo corrige llega con las notificaciones, en la
 * etapa 13, y no vale la pena adelantar dos relojes distintos para lo mismo.
 */
const HOY = new Date();

export default function App() {
  const [anio, setAnio] = useState(HOY.getFullYear());
  const [mes, setMes] = useState(HOY.getMonth() + 1);
  const [porDia, setPorDia] = useState<PorDia>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // El rango pedido son los 42 días que se dibujan, no el mes calendario. La
    // vista pide exactamente lo que muestra.
    const dias = rejilla(anio, mes);
    const desde = clave(dias[0]);
    const hasta = clave(dias[dias.length - 1]);

    let vigente = true;

    listarGrupos()
      .then((grupos) =>
        eventosEnRango(desde, hasta, {
          grupos: grupos.map((g) => g.id),
          importancias: TODAS_LAS_IMPORTANCIAS,
        }),
      )
      .then((resultado) => {
        if (!vigente) return;
        setPorDia(resultado);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!vigente) return;
        setPorDia({});
        setError(String(e));
      });

    // Cambiar de mes rápido deja respuestas viejas en camino. Sin esta marca, la
    // última en llegar gana, que no siempre es la del mes que se está mirando.
    return () => {
      vigente = false;
    };
  }, [anio, mes]);

  function mover(meses: number) {
    const destino = new Date(anio, mes - 1 + meses, 1);
    setAnio(destino.getFullYear());
    setMes(destino.getMonth() + 1);
  }

  function volverAHoy() {
    setAnio(HOY.getFullYear());
    setMes(HOY.getMonth() + 1);
  }

  const mirandoElMesActual =
    anio === HOY.getFullYear() && mes === HOY.getMonth() + 1;

  return (
    <div className="app">
      <div className="barra">
        <div className="titulo">
          <h1>{mesYAnio(anio, mes)}</h1>

          <button className="paso" onClick={() => mover(-1)} title="Mes anterior">
            ‹
          </button>
          <button className="paso" onClick={() => mover(1)} title="Mes siguiente">
            ›
          </button>

          <button className="hoy-btn" onClick={volverAHoy}>
            Hoy
          </button>

          {/* La fecha de hoy, no la del mes navegado. Es el ancla que le da
              sentido al botón de al lado. Se esconde mirando el mes actual,
              donde repetiría el nombre del mes que ya está a la izquierda. */}
          {!mirandoElMesActual && (
            <span className="fecha-hoy">{fechaLarga(HOY)}</span>
          )}
        </div>
      </div>

      {error ? (
        <div className="error">{error}</div>
      ) : (
        <VistaMes
          anio={anio}
          mes={mes}
          hoy={HOY}
          porDia={porDia}
          onNavegar={(a, m) => {
            setAnio(a);
            setMes(m);
          }}
        />
      )}
    </div>
  );
}
