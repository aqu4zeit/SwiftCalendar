# SwiftCalendar

Calendario de escritorio para Windows, sin conexión. Tauri 2 con Rust en el lado
nativo, React 19 con TypeScript en la interfaz y SQLite mediante `rusqlite`.
Proyecto personal: todo, código y conversación, va en español.

## Comandos

```powershell
npm run tauri dev                                  # la aplicación en desarrollo
npx tsc --noEmit                                   # tipos de la interfaz
cargo check --manifest-path src-tauri/Cargo.toml   # el lado nativo compila
cargo test  --manifest-path src-tauri/Cargo.toml   # las pruebas (solo hay en Rust)
```

`npm run dev` sola no sirve para probar: la interfaz depende de `invoke` y fuera
de Tauri no tiene con quién hablar.

## Arquitectura

- **Toda la lógica vive en Rust.** La interfaz dibuja y pide; no calcula fechas,
  no resuelve zonas horarias y no valida reglas de repetición. Si una tarea pide
  lógica en un `.tsx`, va en Rust y se expone como comando.
- **Un único canal de comandos.** `src/api.ts` es el único archivo que llama a
  `invoke`. Todo cruza por ahí, y eso es lo que hace posible deshacer.
- **Agregar un comando** toca cuatro sitios: la función `#[tauri::command]` en
  `src-tauri/src/comandos.rs`, su registro en `generate_handler!` de
  `src-tauri/src/lib.rs`, el envoltorio tipado en `src/api.ts` y, si hace falta,
  el permiso en `src-tauri/capabilities/`. Tauri pasa los argumentos de
  camelCase (TS) a snake_case (Rust); un nombre mal puesto falla recién al
  ejecutar.
- **Los tipos de `api.ts` reflejan los structs de Rust** (`modelo.rs` y
  compañía). Si cambia uno, cambia el otro en el mismo cambio.
- **Nada se conecta a internet.** Los datos viven en `Documentos\SwiftCalendar`:
  `calendario.db` y la carpeta `assets`. Los permisos de `capabilities` se
  mantienen mínimos y acotados a esa carpeta.

## Migraciones

- Viven en `src-tauri/migrations/NNN_nombre.sql` y se incrustan con
  `include_str!` en la lista `MIGRACIONES` de `src-tauri/src/db.rs`. La posición
  en la lista es la versión, guardada en `PRAGMA user_version`.
- **Una migración existente no se edita, no se renombra y no se borra.** Las
  bases ya creadas la aplicaron; cambiarla deja bases viejas y nuevas con
  esquemas distintos sin ningún aviso. Un hook lo bloquea
  (`.claude/hooks/proteger-migraciones.js`).
- Para cambiar el esquema: archivo nuevo con el número siguiente, agregado al
  final de `MIGRACIONES`.

## Reglas del código

- **Primero la teoría, después la evidencia, y recién ahí el arreglo.** Nada se
  cambia sobre una explicación que suena bien pero no está comprobada.
- **Arreglar la clase de error, no el caso.** Una lista de excepciones suele
  señalar que la pregunta estaba mal formulada.
- **Un solo camino para cada cosa.** Sin alternativas ni respaldos.
- **Fallar fuerte.** Lo que no se soporta produce un error visible, no un valor
  por defecto silencioso.
- **Que el tipo impida el estado inválido** en vez de validarlo al ejecutar.
- **Cuando algo se puede sacar, se saca**, y queda registrado por qué.

## Estilo

- Nombres de funciones, tipos, variables y archivos en español
  (`eventos_en_rango`, `VistaMes.tsx`).
- Los comentarios explican el **porqué**, en prosa completa, no el qué. Hay
  que imitar la densidad del código que ya existe, incluidos los comentarios de
  `Cargo.toml` que justifican cada dependencia.
- El código Rust **no** sigue el formato de `rustfmt`: no correr `cargo fmt`
  sobre archivos enteros, porque reformatea todo y ensucia el diff.
- Mensajes de commit en español, en infinitivo o como descripción breve
  ("Quitar el tema claro y agregar el menú propio de la bandeja").

## Documentos de trabajo

El diseño se decidió en `especificacion-calendario.md`, `plan-desarrollo.md` y
`traspaso-desarrollo.md`, que no están en el repositorio. Ante una decisión de
producto que el código no resuelve, preguntar en vez de suponer.
