-- SwiftCalendar — migración 003
--
-- La semilla de la 001 escribió 'generado_hasta' con `datetime('now','localtime')`,
-- que produce '2026-08-09 14:30:00'. El formato del proyecto no lleva segundos, así
-- que el generador de notificaciones no podría leer ese valor en una base recién
-- creada.
--
-- Se corrige acá y no en la 001 porque una migración publicada no se edita. Y se
-- corrige en la base en vez de tolerar los segundos al leer: aceptar dos formatos
-- deja los dos circulando, y el que no se usa reaparece cuando nadie lo espera.
--
-- Recorta a los primeros dieciséis caracteres, que es exactamente
-- 'AAAA-MM-DD HH:MM'. Un valor que ya esté bien mide dieciséis y no cambia.

UPDATE ajuste
SET valor = substr(valor, 1, 16)
WHERE clave = 'generado_hasta';
