-- SwiftCalendar — migración 007
--
-- Se va el tema claro, y con él el ajuste que lo elegía.
--
-- La razón no fue que estuviera mal, sino que la idea siguiente es poder elegir
-- entre varios temas. Con eso, "oscuro o claro" deja de ser una preferencia y
-- pasa a ser dos de una lista que todavía no existe: mantener el interruptor
-- mientras tanto obligaba a decidir dos veces lo mismo el día que la lista
-- llegue.
--
-- La fila se borra en vez de dejarse quieta. Un ajuste que nadie lee es una
-- verdad huérfana, y la tabla de ajustes es justamente el sitio donde este
-- proyecto no admite dos versiones de lo mismo. Cuando existan los temas, una
-- migración nueva traerá la clave que haga falta.

DELETE FROM ajuste WHERE clave = 'tema';
