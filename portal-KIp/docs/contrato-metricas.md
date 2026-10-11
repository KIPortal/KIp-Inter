
## Turnos y guardias (`/api/turnos`, solo COORDINADOR)

- `GET /api/turnos?semana=AAAA-MM-DD` → `{ semana, operadores: [{ id, nombre, area_designada, estado_operativo, horario:{dias,inicio,fin}, horarioPersonalizado, deGuardia, turno:{codigo,etiqueta,enTurno,deGuardia,disponible} }] }`.
- `PUT /api/turnos/guardia` `{ semana?, operatorIds:["uuid", ...] }` → reemplaza la guardia de esa semana (lunes–domingo, Caracas).
- `PUT /api/turnos/horario/:operatorId` `{ dias:[0-6], inicio:"HH:MM", fin:"HH:MM" }` (0 = domingo).
- Códigos de `turno`: `EN_TURNO`, `DE_GUARDIA`, `EN_CASA_GUARDIA`, `FUERA_DE_TURNO`, `AUSENTE`. El dashboard entrega `operador.turno` y `operador.deGuardia`; el de guardia NO cuenta como disponible pero puede recibir tickets.
- Guardia (confirmado): entre semana 17:00–24:00; fin de semana 08:00–24:00 desde casa.
