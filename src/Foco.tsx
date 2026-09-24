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

/**
 * Dónde vuelve el foco cuando lo que abrió una ventana ya no está.
 *
 * Lo declara el marcado y no Foco: una zona (`data-foco-zona`, la celda del
 * día) nombra su ancla (`data-foco-ancla`, el número), y el último recurso
 * (`data-foco-ultimo`, "Nuevo evento") es uno solo en la barra.
 */
const ULTIMO_RECURSO = "[data-foco-ultimo]";

function anclaDe(elemento: Element | null): HTMLElement | null {
  return (
    elemento?.closest("[data-foco-zona]")?.querySelector<HTMLElement>("[data-foco-ancla]") ??
    null
  );
}

/** Sigue en el documento y no se está yendo. */
function vivo(elemento: HTMLElement | null): boolean {
  return elemento !== null && elemento.isConnected && elemento.closest(".saliendo") === null;
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
      /** Adónde volver si el disparador ya no está: el día donde vivía. */
      ancla: HTMLElement | null;
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
     * vacío sin nada a lo que anclarse.
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
      // Si el foco se va por un clic, el clic ya dejó anotado adónde volver
      // (`alApretar` corre antes): anotar la nada encima borraba el día de un
      // clic en el hueco de su celda.
      if (document.documentElement.matches(":active")) return;
      if (evento.relatedTarget === null) recordar(null);
    }

    /*
     * Un clic sobre algo que no se puede enfocar —el hueco de una celda, que
     * abre su día— no deja disparador. Se recuerda el ancla de la zona, el
     * número del día, para que al cerrar el teclado siga desde ahí. Lo que sí
     * se enfoca lo recoge `alEnfocar`.
     */
    function alApretar(evento: PointerEvent) {
      if (!(evento.target instanceof Element)) return;
      if (evento.target.closest(ENFOCABLE)) return;
      recordar(anclaDe(evento.target));
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
    // Lo destructivo lo declara cada botón con `data-destructivo`. Antes se
    // miraba la clase `.malo`, que además marca un campo inválido y que la
    // papelera de "Todos los eventos" no lleva: esa ventana abría con el foco
    // en "Borrar este evento".
    function primeroUtil(ventana: HTMLElement): HTMLElement | null {
      const lista = enfocables(ventana);
      return (
        lista.find((e) => !e.matches(".cerrar, [data-destructivo]")) ?? lista[0] ?? null
      );
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

    /*
     * Adónde vuelve el foco al cerrar, en este orden:
     *
     * 1. Al disparador, si sigue ahí.
     * 2. A ninguno, si el disparador vivía en otra ventana que también se va
     *    o ya se fue: la vuelta la hace esa otra (Escape en "¿Restaurar?" y
     *    Ajustes; "¿Borrar?" y la ficha).
     * 3. Al ancla del disparador —el número de su día— si el disparador ya no
     *    está: el evento que se borró desde su ficha.
     * 4. A lo marcado como último recurso ("Nuevo evento"), si hubo disparador
     *    y no quedó ni él ni su día: por ejemplo, se cambió de mes mientras.
     *
     * Sin disparador —un atajo con nada enfocado— no se elige ninguno: no había
     * dónde estar, e inventarlo sería mentir sobre dónde estaba uno.
     */
    function destinoDe(
      disparador: HTMLElement | null,
      ancla: HTMLElement | null,
    ): HTMLElement | null {
      if (disparador === null) return null;
      if (vivo(disparador)) return disparador;
      // Aunque ya no esté en el documento: un nodo quitado conserva sus
      // ancestros, y si vivía en una ventana, la vuelta es de esa ventana.
      if (disparador.closest(VENTANA)) return null;
      if (ancla !== null && vivo(ancla)) return ancla;
      return document.querySelector<HTMLElement>(ULTIMO_RECURSO);
    }

    function volver(ventana: HTMLElement, destino: HTMLElement | null) {
      // Solo si el foco sigue en la ventana que se va o se perdió. Si ya está
      // en otra —la que la reemplazó—, esa manda. Una que también se está yendo
      // no manda: Escape en "¿Restaurar este respaldo?" cierra también Ajustes,
      // y el foco, que estaba en la pregunta, se quedaba sin nadie que lo
      // devolviera.
      const actual = document.activeElement;
      const perdido =
        actual === null ||
        actual === document.body ||
        ventana.contains(actual) ||
        actual.closest(".saliendo") !== null;
      if (perdido) destino?.focus();
    }

    /*
     * Lo enfocado que se va del calendario —un evento que se borra y hace su
     * salida— deja el foco en su día. Sin esto se perdía un instante después,
     * aunque la ventana ya lo hubiera devuelto a su lugar.
     */
    function sostener() {
      const actual = document.activeElement;
      if (!(actual instanceof HTMLElement) || actual.closest(VENTANA)) return;
      if (actual.closest(".saliendo") === null) return;
      const ancla = anclaDe(actual);
      if (ancla !== null && vivo(ancla)) ancla.focus();
    }

    function sincronizar() {
      const ahora = abiertas();

      // Primero las que se cerraron, para que las nuevas hereden su origen.
      for (let i = pila.length - 1; i >= 0; i--) {
        const { ventana, disparador, ancla } = pila[i];
        if (ahora.includes(ventana)) continue;
        pila.splice(i, 1);
        origen.set(ventana, disparador);
        volver(ventana, destinoDe(disparador, ancla));
      }

      sostener();

      for (const abierta of pila) revisarProvisional(abierta);

      for (const ventana of ahora) {
        if (pila.some((p) => p.ventana === ventana)) continue;
        const disparador = disparadorDe(ventana);
        const abierta: (typeof pila)[number] = {
          ventana,
          disparador,
          ancla: anclaDe(disparador),
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
    document.addEventListener("pointerdown", alApretar, true);
    document.addEventListener("keydown", tecla, true);
    sincronizar();

    return () => {
      observador.disconnect();
      document.removeEventListener("focusin", alEnfocar, true);
      document.removeEventListener("focusout", alDesenfocar, true);
      document.removeEventListener("pointerdown", alApretar, true);
      document.removeEventListener("keydown", tecla, true);
    };
  }, []);

  return null;
}
