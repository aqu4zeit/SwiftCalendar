import { useEffect } from "react";

/** Una ventana que tapa al resto. Todas las de la aplicación lo declaran. */
const VENTANA = '[aria-modal="true"]';

const ENFOCABLE =
  "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]";

/** Cuántos focos recientes se recuerdan para encontrar al disparador. */
const MEMORIA = 20;

/** Las ventanas abiertas, de la de más abajo a la de arriba. */
function abiertas(): HTMLElement[] {
  // Una que se está yendo ya no cuenta: el foco tiene que volver mientras
  // termina su animación, no quedarse adentro hasta que desaparezca.
  return [...document.querySelectorAll<HTMLElement>(VENTANA)].filter(
    (v) => !v.closest(".saliendo"),
  );
}

/** Lo que Tab recorre dentro de una ventana, en su orden. */
function enfocables(ventana: HTMLElement): HTMLElement[] {
  return [...ventana.querySelectorAll<HTMLElement>(ENFOCABLE)].filter(
    (e) => e.tabIndex >= 0 && e.getClientRects().length > 0,
  );
}

/**
 * El foco de teclado en las ventanas: entra al abrir, no se escapa con Tab y
 * vuelve a quien la abrió al cerrar.
 *
 * Es uno solo y escucha el documento, como el globo, en vez de repetirse en
 * cada ventana. Son diecisiete, repartidas en doce archivos, y cada una tiene
 * su propia forma de cerrarse (Escape, la cruz, el clic fuera, una acción que
 * la reemplaza por otra); lo común a todas es que aparecen y desaparecen del
 * documento, y eso es lo que se mira.
 *
 * Sin esto, abrir la ficha con Enter dejaba el foco en el calendario de fondo,
 * Tab seguía recorriendo los días por detrás del velo y al cerrar el foco caía
 * al vacío, así que había que empezar el recorrido desde el principio.
 */
export function Foco() {
  useEffect(() => {
    /**
     * Cada ventana abierta, con el elemento al que hay que volver.
     *
     * `provisional` es el foco que se puso en la cruz porque la ventana todavía
     * no tenía otra cosa: la ficha llega vacía y se llena cuando contesta el
     * lado nativo. Cuando aparece algo mejor el foco se muda, salvo que quien
     * usa el teclado ya lo haya movido.
     */
    const pila: {
      ventana: HTMLElement;
      disparador: HTMLElement | null;
      provisional: HTMLElement | null;
    }[] = [];

    /*
     * A quién devolvía el foco cada ventana ya cerrada.
     *
     * Si una ventana se abre desde otra que se cierra en el mismo gesto —Editar
     * en la ficha abre el formulario y cierra la ficha—, el disparador real ya
     * no existe; el que sirve es el de la ficha, el evento del calendario.
     */
    const origen = new WeakMap<HTMLElement, HTMLElement | null>();

    /*
     * Los últimos elementos enfocados, el más reciente al final.
     *
     * No alcanza con mirar el foco cuando aparece la ventana: si ella misma se
     * enfoca al montarse (el campo del formulario, el de la paleta), para
     * entonces el foco ya está adentro. `null` marca que el foco se fue al
     * vacío, por ejemplo con un clic sobre el hueco de una celda: ahí no hay
     * nadie a quien volver.
     */
    const recientes: (HTMLElement | null)[] = [];

    function recordar(elemento: HTMLElement | null) {
      recientes.push(elemento);
      if (recientes.length > MEMORIA) recientes.shift();
    }

    function alEnfocar(evento: FocusEvent) {
      if (evento.target instanceof HTMLElement) recordar(evento.target);
    }

    function alDesenfocar(evento: FocusEvent) {
      if (evento.relatedTarget === null) recordar(null);
    }

    function disparadorDe(ventana: HTMLElement): HTMLElement | null {
      for (let i = recientes.length - 1; i >= 0; i--) {
        let candidato = recientes[i];
        if (candidato !== null && ventana.contains(candidato)) continue;

        // Si quedó dentro de una ventana que ya se fue, vale el de ella.
        let contenedora = candidato?.closest<HTMLElement>(VENTANA) ?? null;
        while (candidato !== null && contenedora !== null && origen.has(contenedora)) {
          candidato = origen.get(contenedora) ?? null;
          contenedora = candidato?.closest<HTMLElement>(VENTANA) ?? null;
        }
        return candidato;
      }
      return null;
    }

    /*
     * Dónde empieza el teclado: lo primero que sirve. Ni la cruz, que es lo
     * único que no se vino a hacer, ni lo destructivo, que con un Enter de más
     * borraría. La cruz queda solo si no hay otra cosa.
     */
    function primeroUtil(ventana: HTMLElement): HTMLElement | null {
      const lista = enfocables(ventana);
      return lista.find((e) => !e.matches(".cerrar, .malo")) ?? lista[0] ?? null;
    }

    function entrar(abierta: (typeof pila)[number]) {
      const destino = primeroUtil(abierta.ventana);
      destino?.focus();
      abierta.provisional =
        destino !== null && destino.matches(".cerrar") ? destino : null;
    }

    function revisarProvisional(abierta: (typeof pila)[number]) {
      if (abierta.provisional === null) return;
      if (document.activeElement !== abierta.provisional) {
        abierta.provisional = null;
        return;
      }
      if (primeroUtil(abierta.ventana) !== abierta.provisional) entrar(abierta);
    }

    function volver(ventana: HTMLElement, disparador: HTMLElement | null) {
      // Solo si el foco sigue en la ventana que se va o se perdió. Si ya está
      // en otra —la que la reemplazó—, esa manda.
      const actual = document.activeElement;
      const perdido =
        actual === null || actual === document.body || ventana.contains(actual);
      if (!perdido || disparador === null) return;
      if (!disparador.isConnected || disparador.closest(".saliendo")) return;
      disparador.focus();
    }

    function sincronizar() {
      const ahora = abiertas();

      // Primero las que se cerraron, para que las nuevas hereden su origen.
      for (let i = pila.length - 1; i >= 0; i--) {
        const { ventana, disparador } = pila[i];
        if (ahora.includes(ventana)) continue;
        pila.splice(i, 1);
        origen.set(ventana, disparador);
        volver(ventana, disparador);
      }

      for (const abierta of pila) revisarProvisional(abierta);

      for (const ventana of ahora) {
        if (pila.some((p) => p.ventana === ventana)) continue;
        const abierta: (typeof pila)[number] = {
          ventana,
          disparador: disparadorDe(ventana),
          provisional: null,
        };
        pila.push(abierta);
        // La que se enfoca sola al montarse ya eligió dónde empezar.
        if (!ventana.contains(document.activeElement)) entrar(abierta);
      }
    }

    // Tab da la vuelta dentro de la ventana de arriba. Fase de captura: tiene
    // que decidir antes de que el navegador mueva el foco por su cuenta.
    function tecla(evento: KeyboardEvent) {
      if (evento.key !== "Tab") return;
      const todas = abiertas();
      const ventana = todas[todas.length - 1];
      if (!ventana) return;

      const lista = enfocables(ventana);
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      if (!primero || !ultimo) return;

      const actual = document.activeElement;
      const destino = !ventana.contains(actual)
        ? evento.shiftKey
          ? ultimo
          : primero
        : evento.shiftKey && actual === primero
          ? ultimo
          : !evento.shiftKey && actual === ultimo
            ? primero
            : null;

      if (destino === null) return;
      evento.preventDefault();
      destino.focus();
    }

    const observador = new MutationObserver(sincronizar);
    observador.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });
    document.addEventListener("focusin", alEnfocar, true);
    document.addEventListener("focusout", alDesenfocar, true);
    document.addEventListener("keydown", tecla, true);
    sincronizar();

    return () => {
      observador.disconnect();
      document.removeEventListener("focusin", alEnfocar, true);
      document.removeEventListener("focusout", alDesenfocar, true);
      document.removeEventListener("keydown", tecla, true);
    };
  }, []);

  return null;
}
