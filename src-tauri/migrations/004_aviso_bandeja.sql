-- SwiftCalendar — migración 004
--
-- El aviso que explica, la primera vez que se cierra la ventana, que la
-- aplicación sigue viva en la bandeja. Necesita recordar si ya se mostró, y esa
-- marca no existía.
--
-- Las otras dos claves de la bandeja —'bandeja' y 'arranque'— ya vienen de la
-- semilla de la 001, así que acá no se tocan. Una migración publicada no se
-- edita, y agregar de nuevo una clave que ya está fallaría contra la primaria.
--
-- '0' significa que todavía no se mostró. Al mostrarlo pasa a '1', y el usuario
-- puede volver a bajarlo desde los ajustes.

INSERT INTO ajuste (clave, valor) VALUES ('aviso_bandeja_visto', '0');
