
## Turnos y guardias (`/api/turnos`, solo COORDINADOR)

- `GET /api/turnos?semana=AAAA-MM-DD` → `{ semana, operadores: [{ id, nombre, area_designada, estado_operativo, horario:{dias,inicio,fin}, horarioPersonalizado, deGuardia, turno:{codigo,etiqueta,enTurno,deGuardia,disponible} }] }`.
- `PUT /api/turnos/guardia` `{ semana?, operatorIds:["uuid", ...] }` → reemplaza la guardia de esa semana (lunes–domingo, Caracas).
- `PUT /api/turnos/horario/:operatorId` `{ dias:[0-6], inicio:"HH:MM", fin:"HH:MM" }` (0 = domingo).
- Códigos de `turno`: `EN_TURNO`, `DE_GUARDIA`, `EN_CASA_GUARDIA`, `FUERA_DE_TURNO`, `AUSENTE`. El dashboard entrega `operador.turno` y `operador.deGuardia`; el de guardia NO cuenta como disponible pero puede recibir tickets.
- Guardia (confirmado): entre semana 17:00–24:00; fin de semana 08:00–24:00 desde casa.

## Traspaso a guardia (Fase 3 del rediseño)

El traspaso **no reasigna**: guarda un lote aparte (`Traspaso` + `TraspasoTicket`, migración `20261013120000_traspaso_guardia`).

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/tickets/handoff` | `{ ticketCodes: string[], nota: string (≥ 10) }` | `{ success, count, traspasoId }`; 409 si alguno está resuelto o cerrado |
| `GET /api/tickets/handoff/actual` | — | `{ success, traspaso: { id, nota, autor, creadoEn, venceEn, total, pendientes: string[], vigente } \| null }` |
| `POST /api/tickets/handoff/:id/atendido` | — | `{ success }`; 409 si ya estaba atendido |

- **Pendientes:** tickets del lote que no están resueltos, cerrados ni en la papelera.
- **Vigencia:** se muestra hasta las 08:00 (Caracas) siguientes al envío, hasta que no queden pendientes o hasta que el coordinador lo marque como atendido.
- Cada ticket queda en Auditoría con `TICKET_TRASPASADO_GUARDIA` y la nota; el atendido, con `TRASPASO_ATENDIDO`.
- `POST /api/tickets/:code/close` acepta `{ motivo?: string (≤ 300) }`, que se guarda en Auditoría.

## Conversación del ticket (pestaña Conversación del detalle del operador)

Tabla `Mensaje` (migración `20261014150000_conversacion_ticket`): `tipo` = `ENTRANTE` (correo del cliente), `SALIENTE` (respuesta del operador) o `NOTA` (interna). El correo que abrió el ticket no se copia: sale de `Ticket.descripcion`, `remitente` y los `Adjunto` sin `mensajeId`.

| Método y ruta | Quién | Cuerpo | Respuesta |
|---|---|---|---|
| `GET /api/tickets/:code/conversacion` | Coordinador; operador si el ticket es suyo o está sin tomar en su área o en la general | — | `{ success, conversacion }` |
| `POST /api/tickets/:code/mensajes` | Operador asignado (ticket no cerrado) | multipart: `tipo` (`out`\|`note`), `texto` (≤ 5000), `esperar` (`true` solo con `out`), `adjuntos` (≤ 5; un correo ≤ 3 MB en total) | `{ success, enviado, aviso, estado, conversacion }` |

- `conversacion`: `{ codigo, estado, total, items:[{ id, k: in\|out\|note\|sys, quien, meta, hora, texto, adjuntos:[{nombre,url,peso}] }], puedeEscribir, motivoNoEscribir, puedeEsperar, esperando, esperaTexto, para, asunto, plantillas:[{etiqueta,texto}], limites }`. `total` no cuenta los eventos (`sys`); `hora` va en hora de Caracas ("Hoy 11:41").
- **Respuesta al cliente:** sale por Graph desde el buzón compartido con asunto `Re: [INC-xxx] …`, para que la respuesta del cliente vuelva al mismo ticket. Sin Graph configurado se guarda con `enviado: false` y la burbuja dice "Correo no enviado".
- **Enviar y esperar respuesta:** solo desde `EN_PROGRESO` o `EN_PAUSA` (409 si no); pasa a `EN_ESPERA_TERCEROS` y audita `TICKET_EN_ESPERA`.
- **Correo del cliente** con `INC-xxx` en el asunto: entra como `ENTRANTE`; si el ticket estaba en espera, vuelve a `EN_PROGRESO` y audita `TICKET_REANUDADO` ("Respondió el cliente").
