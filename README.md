# SwiftCalendar

Calendario de escritorio para Windows. Liviano, sin conexión, con todo guardado
en disco.

Los eventos se agrupan en categorías que crea el usuario y se filtran por grupo y
por importancia. Admite eventos repetidos, de varios días, con imagen recortable,
archivos adjuntos y recordatorios que avisan dentro de la propia aplicación.

**Proyecto personal.** No busca competir con nada ni servir a nadie más: existe
para tener un calendario que haga exactamente lo que se le pidió y nada más.

---

## Qué hace hoy

- **Vista mes** de seis filas fijas, con marca de semana actual y día de hoy
- **Vista día** en ventana flotante, con el horario de cada evento
- **Ficha del evento** con su imagen, sus archivos y sus datos
- **Crear, editar y borrar**, y en un evento repetido, elegir entre esta
  ocurrencia o toda la serie
- **Grupos** con color propio, reordenables arrastrando
- **Filtros** por grupo y por importancia
- **Imagen** con recorte elegido a mano antes de guardarla, y previsualización de
  cómo va a quedar en cada sitio
- **Adjuntos** que se abren con el programa que les corresponda
- **Recordatorios** que aparecen en un panel propio, con historial

## Qué falta

Bandeja del sistema, compartir eventos en archivos `.calev`, ajustes, respaldo,
tema claro, paleta de comandos y `Ctrl+Z`. Están repartidos en las etapas 14 a 16.

---

## Cómo funciona por dentro

**Tauri 2** con **Rust** en el lado nativo, **React** con **TypeScript** en la
interfaz y **SQLite** mediante `rusqlite`.

Toda la lógica vive en Rust. La interfaz dibuja y pide; no calcula fechas, no
resuelve zonas horarias y no valida reglas de repetición. Todo cruza por un único
canal de comandos, que es lo que hace posible deshacer.

```
src/          la interfaz
src-tauri/    el lado nativo, las migraciones y la configuración
```

Los datos del usuario viven en `Documentos\SwiftCalendar`: la base de datos y una
carpeta `assets` con las imágenes y los adjuntos. Nada sale de ahí y nada se
conecta a internet.

---

## Correrlo

Hace falta [Rust](https://rustup.rs) y [Node](https://nodejs.org).

```powershell
npm install
npm run tauri dev
```

Las pruebas del lado nativo:

```powershell
cd src-tauri
cargo test
```

---

## Cómo se construyó

El proyecto sigue un plan de dieciséis etapas y tres documentos que son la fuente
de verdad. No están en este repositorio porque son documentos de trabajo, pero
gobiernan cada decisión del código:

| Documento | Qué contiene |
|---|---|
| `especificacion-calendario.md` | Qué hace la aplicación y por qué. Más de noventa decisiones registradas, cada una con su razón |
| `plan-desarrollo.md` | Las dieciséis etapas y lo que salió de cada una, incluidos los errores |
| `traspaso-desarrollo.md` | Cómo retomar el proyecto desde cero |

Cinco archivos HTML sirven de referencia visual. Describen el diseño, no lo
agotan: que algo no esté dibujado no significa que se haya decidido no dibujarlo.

### Las reglas que sostienen el código

- **Primero la teoría, después la evidencia, y recién ahí el arreglo.** Ningún
  cambio se hace sobre una explicación que suena bien pero no está comprobada
- **Arreglar la clase de error, no el caso.** Cuando aparece una lista de
  excepciones, casi siempre la pregunta estaba mal formulada
- **Un solo camino para cada cosa.** Sin alternativas ni respaldos
- **Fallar fuerte.** Lo que no se soporta produce un error visible
- **Que el tipo impida el estado inválido** en vez de validarlo al ejecutar
- **Cuando algo se puede sacar, se saca**, y queda registrado por qué

### Estado

Etapas 1 a 13 completas. Las pruebas del lado nativo pasan.

| Etapa | Qué produjo |
|---|---|
| 1–5 | Base de datos, resolución de hora, canal de comandos, recurrencia, consulta de rango |
| 6–7 | Vista mes y contenido de las celdas |
| 8–10 | Formulario, ficha del evento y vista día |
| 11 | Grupos, colores y filtros |
| 12 | Imágenes con recorte, y adjuntos |
| 13 | Recordatorios y panel de notificaciones |
| 14–16 | Bandeja, compartir y cierre — pendientes |
