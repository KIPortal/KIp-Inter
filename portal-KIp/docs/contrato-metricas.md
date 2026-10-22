
## Turnos y guardias (`/api/turnos`, coordinador, jefe o gerente; el jefe solo su área)

- `GET /api/turnos?semana=AAAA-MM-DD` → `{ semana, operadores: [{ id, nombre, area_designada, estado_operativo, horario:{dias,inicio,fin}, horarioPersonalizado, deGuardia (hoy), guardiaDias:["AAAA-MM-DD"] (de esa semana), turno:{codigo,etiqueta,enTurno,deGuardia,disponible} }] }`.
- `PUT /api/turnos/guardia` `{ semana?, dias:{ "AAAA-MM-DD":["uuid", ...] } }` → reemplaza la guardia por día de esa semana (lunes–domingo, Caracas; fechas fuera de la semana = 400). Con `operatorIds:[...]` en vez de `dias` pone a esas personas los 7 días. El jefe solo reemplaza la de su área. Tabla `GuardiaDia` (`fecha` = 00:00 Caracas); `GuardiaSemanal` queda solo como histórico.
- Gestión de Turno: `buildShiftBoard` recibe `guardiaPorDia` (Map fecha → Set de ids) y entrega `operadores[].guardiaDias`, `semana.dias[].guardias[{id,nombre,iniciales}]` y `semana.sinGuardia`.
- `PUT /api/turnos/horario/:operatorId` `{ dias:[0-6], inicio:"HH:MM", fin:"HH:MM" }` (0 = domingo).
- Códigos de `turno`: `EN_TURNO`, `DE_GUARDIA`, `EN_CASA_GUARDIA`, `FUERA_DE_TURNO`, `AUSENTE`. El dashboard entrega `operador.turno` y `operador.deGuardia`; el de guardia NO cuenta como disponible pero puede recibir tickets.
- Guardia (confirmado): por día; entre semana 17:00–24:00 en la oficina (unos 2 días por persona); fin de semana 08:00–24:00 desde casa. "De guardia" = tiene guardia hoy.

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

## Panel del operador (Fase 9, `GET /` con rol OPERADOR)

Lo arma `src/services/operatorPanelService.js` (`buildOperatorPanel`); la vista `operator-dashboard.ejs` dibuja encabezado, tarjetas y traspaso, y `public/js/operador.js` la bandeja.

- **Colas:** `entrantes` (NUEVO sin asignar de su área y de General), `asignados` (NUEVO asignado a él por el coordinador; "Empezar" usa `POST /api/tickets/:code/claim`), `atencion` (EN_PROGRESO), `espera` (EN_PAUSA y EN_ESPERA_TERCEROS), `resueltos` (RESUELTO/CERRADO con fin de trabajo hoy). Orden: P1 primero, luego el más antiguo.
- **Columna de tiempo:** Esperando (desde la llegada), Asignado hace / En atención (desde `fecha_asignacion`), Detenido (desde `updatedAt`), Puntos (en resueltos).
- **Alerta de antigüedad** en Entrantes con las reglas de Administración (`antiguedad.P1…SP`, se puede apagar).
- **Tarjetas:** Mi turno (reloj de 12 h con el arco de la jornada o de la guardia), Pendientes (asignados / en atención / en espera), Resueltos hoy (pendientes de cierre / cerrados) y "puntos hoy" (suma de `puntos_complejidad` de los resueltos hoy). El operador no ve sobrecarga ni el promedio del área.
- **Disponibilidad:** Disponible y Atendiendo (con un P1 en atención) son automáticos; Fuera de puesto (`EN_TERRENO`, el motivo y la hora de regreso quedan en el navegador y vuelve solo a Disponible) y Ausente (`AUSENTE`) usan `PATCH /api/operators/:id/status`.
- **Pausar / Resolver:** `PATCH /api/tickets/:code/status` con `status` = `EN_PAUSA`, `EN_ESPERA_TERCEROS` (nuevo, desde EN_PROGRESO, audita `TICKET_EN_ESPERA`) o `RESUELTO`, y `nota` opcional (≤ 500) que va al detalle de la auditoría.
- **Avisos (campana):** se deducen de las colas (P1 nuevo en su área, antigüedad superada, asignado por el coordinador). La matriz de avisos de Administración se conecta en la Fase 10.
- **Pendientes del traspaso:** solo si está de guardia y hay un traspaso vigente.

## Coordinador que también atiende tickets

Campo `User.atiende_tickets` (migración `20261014180000_coordinador_atiende`), se marca en Administración → Usuarios ("También atiende tickets"). `src/services/roleService.js` define `atiendeTickets(user)`, `ATIENDE_WHERE` y el middleware `authorizeWorker`.

- Puede usar las rutas del operador (`claim`, `status`, `pause`, `resume`, `resolve`, `mensajes`, `PATCH /api/operators/:id/status`) y tiene `GET /mi-panel` (el mismo panel del operador).
- Toma tickets de cualquier área: botón **Tomar** en el detalle de Tickets (`POST /api/tickets/:code/claim`, queda EN_PROGRESO a su nombre).
- Cuenta como operador en carga, sugerencias, Gestión de Turno y reportes; en Administración aparece en la lista de coordinadores.

## Roles Jefe de área y Gerente, y Contactos

- `roleService`: `esSupervisor` (COORDINADOR, JEFE, GERENTE), `puedeAdministrar` (COORDINADOR, GERENTE), `areaScope`/`areasVisibles` (el jefe: su área y GENERAL), `ticketWhere`, `personaWhere`, `motivoNoGestionar`.
- Rutas: `/api/tickets` de coordinación usan `authorizeSupervisor` + `limitarAlArea` (`src/middlewares/areaScope.js`): para el jefe, el ticket (por código), el área enviada y el `operatorId` deben ser de su área (403 si no). `/api/turnos` y `/reportes/data|excel`: `authorizeSupervisor`. `/admin`, `/api/admin`, `/auditoria`: `authorizeAdmin`.
- Jefe: Dashboard, Tickets (incluida la papelera), Gestión de Turno y Reportes filtran por su área; el reporte fuerza `area` a la suya. Al definir la guardia solo reemplaza la de su área.
- Administración: `POST/PATCH /api/admin/usuarios` aceptan `rol` JEFE/GERENTE y `telefono` (texto ≤40, números, +, (), guiones, puntos, "ext"; vacío = sin teléfono). Solo el gerente da esos roles o edita a jefes y gerentes (403). El jefe necesita un área distinta de General (400).
- Contactos: `GET /contactos` (cualquier usuario) dibuja `contactService.buildContacts` → `{ grupos[{codigo, nombre, personas[{id, nombre, iniciales, rol, rolTxt, email, telefono, tel, estado{etiqueta, grupo}|null, esYo}]}], total, sinTelefono, yo{telefono} }`. Gerencia primero, luego las áreas en su orden; dentro, jefe, coordinador y operador. `PATCH /api/contactos/yo { telefono }` guarda el propio teléfono y deja `USUARIO_EDITADO` en Auditoría.

## Subgrupos de área

- Tabla `Subgrupo { id, area_codigo, nombre, activo, orden }` (migración `20261015000000_subgrupos`); `User.subgrupo_id` y `Ticket.subgrupo_id` opcionales (al borrar: null).
- Administración: `POST /api/admin/areas/:codigo/subgrupos { nombre }` (409 si se repite en el área), `PATCH /api/admin/subgrupos/:id { nombre?, activo? }` (409 al desactivar con personas activas o tickets activos). Usuarios: `subgrupo` (id o vacío) en `POST/PATCH /api/admin/usuarios`; debe ser activo y de su área; si cambia de área sin elegir otro, queda sin subgrupo.
- `PATCH /api/admin/usuarios/:id { activo: false }`: los tickets activos de esa persona vuelven a NUEVO sin asignar (auditoría `TICKET_DESASIGNADO`); la respuesta trae `devueltos: [códigos]`.
- Tickets: `POST /api/tickets { subgrupoId? }`, `PATCH /api/tickets/:code { subgrupo_id }` (validados contra el área final). Al asignar, si el ticket no tiene subgrupo toma el del operador (misma área); si cambia de área, se quita.
- `buildQueue`: `areas[].subgrupos[{id,nombre}]` (activos), `tickets[].subgrupo/subgrupoNombre`, `operadores[].subgrupo/subgrupoNombre`. El filtro Área acepta `AREA|subgrupo`.
- `buildCoordinatorPanel`: `areas[] = { codigo, nombre, abiertos, sinAsignar, total, puntos, personas, capacidad, porcentaje, resueltos, promedioHoras, operadores }`. `porcentaje` es la saturación: puntos abiertos (los del nivel del tipo de caso: N1=2, N2=4, N3=8, N4=10; sin clasificar = 2, `metricsService.pesoCarga`) ÷ (personas en turno o de guardia, no ausentes, × `reglas.capacidad.puntosPorPersona`, 16 por defecto). Sin nadie en turno y con abiertos = 100. Cada operador trae `carga` (tickets activos) y `puntosCarga` (sus puntos activos); `indiceCarga` y `sobrecarga` se calculan con los puntos.
- `GET /api/avisos/coordinador` (coordinador, jefe o gerente; el jefe solo su área): `{ activo, porCerrar[{ codigo, asunto, operador, area, resueltoEn, hace }] }`, tickets en RESUELTO que esperan cierre (máx. 30). `activo` sale de la matriz de avisos (`resuelto`). `GET /api/cambios`: `{ sello }` para la actualización en vivo.
- Mi panel: con subgrupo, Entrantes = los de su subgrupo + los del área sin subgrupo (+ General).

## Distribución territorial (mapa del Dashboard)
- `Ticket.estado_ve` (opcional, código ISO sin guion: `VEA`, `VEV`...) lo elige el coordinador al crear (`estadoVe`) o editar (`estado_ve`) el ticket.
- `panel.mapa` (`buildTerritorialMap`): `estados[codigo] = { nombre, activos, porcentaje }`, `ranking` (7 con más activos), `totalActivos`, `sinEstado`, `resumen`. Los tickets sin estado no entran al mapa.

## Registro de jornadas (Reportes)
- Cada día a las 00:05 (Caracas) el portal registra la jornada anterior: foto de tickets y operadores en la tabla `RegistroJornada` (`datos`, `resumen`, `origen` AUTOMATICO | MANUAL | RECUPERADO) y el Excel en `registros/jornadas/AAAA/MM/jornada-AAAA-MM-DD.xlsx` (carpeta configurable con `REGISTROS_DIR`; `CIERRE_JORNADA=off` apaga el cierre automático). Al arrancar, si falta el registro de ayer, lo toma (RECUPERADO).
- `GET /reportes/data`, `/reportes/excel` y la pantalla Reportes: un periodo ya terminado con todos sus días registrados se arma con las fotos (cada ticket con su estado del último cierre del periodo); si no terminó o falta algún día, en vivo. `?fuente=vivo` fuerza en vivo. La respuesta trae `fuente { tipo: 'registro'|'vivo', terminado, dias, guardados[], faltan[], registro }`.
- `POST /reportes/jornadas/cerrar` `{ fecha?, reemplazar? }` (supervisor): guarda la jornada (hoy si no hay fecha). Si ya existe devuelve 409 `{ existe: true }`; con `reemplazar: true` la sustituye. Queda en Auditoría como `JORNADA_CERRADA`.
- `GET /reportes/jornadas?desde=&hasta=&limite=`: lista de jornadas registradas con `creados`, `resueltos`, `activos`, `puntos`, `tieneExcel`.
- `GET /reportes/jornadas/:fecha/excel`: Excel guardado de ese día (el jefe recibe uno regenerado solo con su área; si el archivo no está en disco se regenera desde la foto).
- `npm run datos:cero` borra también el registro de jornadas (los Excel en disco se conservan); `limpiar-simulacion` quita SIM-xxx y los usuarios @demo.local de las fotos y recalcula su resumen. Cada foto lleva `datos.v` (versión de su forma).

## Tipos de caso y puntos por nivel (ver especificación §16)
- Tabla `TipoCaso` (migración `20261022120000_tipos_caso`, que además carga los casos de los Excel de FTTx y WAN). `Ticket` suma `prioridad` (P1/P2/P3 o null), `nivel` (1-4) y `tipo_caso_id`; `puntos_complejidad` = puntos del nivel (N1=2, N2=4, N3=8, N4=10).
- Tickets y Mi panel reciben en `datos` `tiposCaso: [{ id, nombre, area, areaNombre, subgrupo, subgrupoNombre, nivel, puntos, minutos, frecuencia, dependencias, activo }]` (solo activos; en memoria hasta que Administración crea o edita uno) y `niveles: { puntos, nombres }` (de `tipoCasoService`; las pantallas no copian la tabla).
- `POST /api/admin/tipos-caso` `{ nombre, area, nivel, minutos?, frecuencia?, dependencias?, subgrupo? }` y `PATCH /api/admin/tipos-caso/:id` (los mismos campos, parciales, más `activo`; el área no cambia). Auditoría `TIPO_CASO_CREADO` / `TIPO_CASO_EDITADO`. Nombre repetido en el área = 409.
- `POST /api/tickets/:codigo/claim`: un ticket sin nivel exige `{ tipoCasoId }` (del área del ticket) o `{ nivel: 1-4 }` ("Otro"); sin él responde 422 `{ requiereTipo: true }` (y `requierePrioridad` si además falta la prioridad).
- `PATCH /api/tickets/:codigo` acepta `tipoCasoId` / `nivel` (con `{ tipoCasoId: null, nivel: null }` se quita: 0 pts) y `prioridad` (`P1`|`P2`|`P3`|`NONE`), que ya no cambia los puntos. `POST /api/tickets` acepta `tipoCasoId`/`nivel` opcionales. Desasignar deja la prioridad en null y conserva el tipo.
- Filas de la cola (ticketQueueService) y del panel del operador: `tipoCaso` (nombre, "Otro" o ""), `tipoCasoId`, `nivel`, `minutosEstimados`.
- Reporte por periodo: `casosComunes { dias, recibidos, clasificados, sinClasificar, filas[{ tipoId, nombre, area, nivel, puntosNivel, ocurrencias, porDia, participacion, resueltos, puntos, frecuencia, minutosEstimados, estimado, tiempoPromedioMin, tiempoPromedio, sobreEstimado }] }`; `detalle[]` suma `nivel` y `tipoCaso`. El Excel suma la hoja "Casos Comunes" y las columnas Tipo de caso y Nivel en el detalle. La vista de Reportes entrega `casos` (con `ancho` y `pct`).
- Simulación: `buildSimulation`/`buildDemo` aceptan `tipos` (`cargarTiposCaso(prisma)`); en un área con catálogo cada ticket es uno de sus tipos (elegido por frecuencia: Alta 6, Media 3, Baja 1; 10 % "Otro") con su nivel y su tiempo estimado. Los que quedan en la cola salen sin tipo.

## Prioridad de los tickets de correo
- Al llegar un correo, `rulesService.sugerirPrioridad` busca las palabras clave de `reglas.palabrasPrioridad` (`{ P1: [], P2: [], P3: [] }`, editables en Administración → Reglas) en asunto, texto y remitente (sin tildes ni mayúsculas, palabra completa; gana la más alta) y guarda `Ticket.prioridad_sugerida`. La prioridad y los puntos siguen vacíos hasta que alguien lo toma.
- `POST /api/tickets/:codigo/claim` con un ticket sin prioridad exige `{ prioridad: 'P1'|'P2'|'P3' }`; sin ella responde 422 `{ requierePrioridad: true, sugerida }`. La auditoría (TICKET_TOMADO) dice qué prioridad se eligió y cuál era la sugerida.
- Filas: `sugerida` en la bandeja del operador (operatorPanelService) y en la cola de Tickets (ticketQueueService), solo cuando el ticket no tiene prioridad.
