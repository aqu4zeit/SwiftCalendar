// Impide editar o sobrescribir una migración que ya existe.
//
// Las migraciones van incrustadas en el binario y cada base guarda hasta cuál
// aplicó. Si se cambia una ya aplicada, las bases viejas y las nuevas quedan con
// esquemas distintos y nada lo avisa. Crear una migración nueva sí se permite.

// Es un módulo ES porque `package.json` declara `"type": "module"`.
import fs from "node:fs";

const entrada = JSON.parse(fs.readFileSync(0, "utf8"));
const archivo = entrada.tool_input?.file_path ?? "";
const ruta = archivo.replace(/\\/g, "/");

if (/src-tauri\/migrations\/[^/]+\.sql$/i.test(ruta) && fs.existsSync(archivo)) {
  console.error(
    `${ruta.split("/").pop()} ya existe y puede estar aplicada en bases de usuarios. ` +
      "No se edita: crea una migración nueva con el número siguiente y agrégala al " +
      "final de MIGRACIONES en src-tauri/src/db.rs.",
  );
  process.exit(2);
}
