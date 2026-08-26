-- SwiftCalendar — migración 002
--
-- El formato de hora visible: 12 o 24 horas, a elección del usuario. Aplica en
-- todas las pantallas sin excepción.
--
-- Aparece acá y no en la 001 porque una migración publicada no se edita: hay
-- bases en disco que ya aplicaron la primera, y cambiarla dejaría dos esquemas
-- distintos con el mismo número de versión.

INSERT INTO ajuste (clave, valor) VALUES ('formato_hora', '24');
