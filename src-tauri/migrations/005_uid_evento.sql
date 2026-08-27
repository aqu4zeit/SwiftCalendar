-- SwiftCalendar — migración 005
--
-- El identificador que viaja dentro del archivo `.calev`.
--
-- El `id` de la tabla es un número que solo significa algo en esta base: dos
-- equipos distintos tienen eventos con el id 7 y no son el mismo evento. Para
-- que al importar se pueda avisar "esto ya lo tienes", hace falta un
-- identificador que sea único entre máquinas.
--
-- Lo genera SQLite con `randomblob`, así que no entra una dependencia nueva solo
-- para esto. Dieciséis bytes en hexadecimal: el mismo tamaño que un UUID.
--
-- Un evento importado adopta el identificador del archivo en vez de recibir uno
-- nuevo: es el mismo evento, y así reimportar el archivo se detecta con la misma
-- consulta que detecta importar un archivo hecho desde un evento que ya está.
-- Por eso el índice no es único: si el usuario ignora el aviso y lo importa dos
-- veces igual, la base no tiene por qué impedírselo.

ALTER TABLE evento ADD COLUMN uid TEXT;

UPDATE evento SET uid = lower(hex(randomblob(16))) WHERE uid IS NULL;

CREATE INDEX idx_evento_uid ON evento(uid);
