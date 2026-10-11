# Especificación: Métricas, Tickets y Reportes del Coordinador

**Estado:** Borrador para revisión
**Alcance:** Fase A (métricas correctas) y diseño de la nueva sección Tickets y de los reportes por periodo.

---

## 1. Objetivo

Que el coordinador de cada área pueda:

1. Ver de un vistazo qué está pasando en el turno.
2. Controlar todos los tickets de su área: asignarlos, priorizarlos y cerrarlos.
3. Detectar sobrecarga en los operadores antes de que se vuelva un problema.
4. Obtener un reporte por jornada, semana, mes o fecha específica, con descarga en Excel.

---

## 2. Roles

| Rol | Puede |
|---|---|
| **Coordinador de área** | Ver todo su área, asignar, reasignar, definir prioridad y puntos, cerrar tickets de su área, ver reportes y exportarlos. |
| **Administrador general** | Todo lo del coordinador, en todas las áreas. Puede cerrar tickets de cualquier área. |
| **Operador** | Ver tickets disponibles de su área, tomarlos, pausarlos, marcarlos como resueltos y consultar sus propios indicadores. |

---

## 3. Horario y disponibilidad

- **Turno normal:** 8:00 a 17:00.
- **Guardia:** 17:00 a 00:00. Dos operadores en edificio. Hay respaldo remoto para emergencias.
- **Fin de semana:** el operador de guardia trabaja desde casa.
- Cada operador tiene un **horario asignado** (días y franja). Con esto el sistema sabe si está disponible.
- El horario se guarda como dato del operador, no como regla fija.
- **Rotación de guardia semanal:** las guardias cambian cada semana. El coordinador las define desde **Gestión de Turno**, indicando qué operadores están de guardia en cada semana.
- **Estado del operador de guardia:**
  - En la jornada normal **no aparece como "Disponible"**, aparece como **"De guardia"** (o "En casa de guardia" si trabaja remoto).
  - Puede **recibir contacto** (se muestra su teléfono o canal de contacto) y **ver y resolver los tickets** que llegan al correo desde su casa.
  - No cuenta como disponible para asignación en la jornada normal, salvo que el coordinador lo active.

---

## 4. Estados del ticket

| Estado | Quién lo cambia | Significado |
|---|---|---|
| **Nuevo** | Sistema (al llegar el correo) | Entró al área y nadie lo ha tomado. |
| **En progreso** | Operador o coordinador | Alguien lo está atendiendo. |
| **En pausa** | Operador | Se detuvo temporalmente por una razón interna. |
| **En espera de terceros** | Operador | Depende de un tercero (proveedor, otra área, cliente). |
| **Resuelto** | Operador | El operador terminó su trabajo. Se sella la fecha de resolución. |
| **Cerrado** | Coordinador | El coordinador confirmó que quedó bien ejecutado. |

**Regla:** el tiempo de solución se mide hasta **Resuelto**, no hasta **Cerrado**. El cierre del coordinador es control de calidad, no tiempo de atención.

**Pendiente por revisar (activo):** cualquier ticket que no esté en **Resuelto** ni **Cerrado**. Son los casos que el operador puede ver y atender.

---

## 5. Prioridad y puntos

- Los tickets **entran sin prioridad**. El operador no puede asignarla, para evitar sobrestimar casos.
- El **coordinador** define la prioridad al asignar el ticket o al cerrarlo, porque conoce la complejidad de su área.
- Los puntos de complejidad se derivan de la prioridad (valores ya definidos en `PRIORITY_POINTS`).
- Mientras un ticket no tenga prioridad, no cuenta en "Críticos sin asignar".

---

## 6. Definición de indicadores

Todos los indicadores se calculan en el backend para un **periodo** (jornada, semana, mes o fecha específica) y una **área** (o todas).

### 6.1 Volumen

| Indicador | Fórmula |
|---|---|
| Tickets creados | Nº de tickets con `createdAt` dentro del periodo. |
| Tickets asignados | Nº de tickets con `fecha_asignacion` dentro del periodo. |
| Tickets resueltos | Nº de tickets con `fecha_resuelto` dentro del periodo. |
| Tickets cerrados | Nº de tickets con `fecha_cierre` dentro del periodo. |
| Tickets activos (por revisar) | Nº de tickets no resueltos ni cerrados al momento de consulta. |

### 6.2 Tiempo de solución

Se muestran **dos medidas** en paralelo, claramente etiquetadas:

| Medida | Fórmula | Para qué sirve |
|---|---|---|
| **Tiempo total** | Promedio de (`fecha_resuelto` − `createdAt`) | Ver tickets que llevan mucho tiempo esperando, incluidas noches y fines de semana. |
| **Tiempo en horario** | Igual que el anterior, pero contando solo las horas dentro del horario de turno de la asignación | Medir la operatividad real del área. |

- El promedio se calcula como: **suma de tiempos ÷ número de tickets resueltos**.
- Se muestra por área y, en la vista de operador, por persona.
- No se usa mediana.

### 6.3 Flujo horario

- Tickets recibidos por hora (00:00 a 23:59) en el periodo seleccionado.
- Permite ver horas pico para distribuir turnos.

### 6.4 Carga por operador

- Tickets asignados y resueltos por operador en el periodo.
- Tickets activos asignados en el momento.

---

## 7. Sobrecarga

- Se calcula un **índice de carga** por operador:
  **índice = tickets activos del operador ÷ promedio de tickets activos de su área**
- **Alerta** cuando el índice supera **1.5** (un operador tiene 50% más carga que el promedio del área).

**Ejemplo:** en un área, el promedio de tickets activos es **4**. El umbral es 1.5 × 4 = **6**. Si un operador tiene **7 o más** tickets activos, se le marca con alerta de sobrecarga. Con 6 o menos, no.
- La alerta **solo se muestra al coordinador**. Él decide si asigna más o no.
- No se busca igualdad exacta: un operador puede tener más carga que otro, siempre que el balance general del área sea razonable.
- Se evalúa con los tickets activos en el momento, no con histórico.

**Reglas que completan el cálculo** (ya implementadas en `src/services/metricsService.js`):

- **Tickets activos de un operador:** todos los que tiene asignados y no están cerrados: *Nuevo* (asignado y aún sin tomar), *En progreso*, *En pausa* y *En espera de terceros*.
- **Mínimo de 3 tickets activos** para que salte la alerta. Si el promedio del área es casi cero, 1 o 2 tickets darían un índice enorme sin que haya sobrecarga real.
- **Los operadores ausentes no cuentan en el promedio:** no pueden tomar trabajo y bajarían el promedio, provocando alertas falsas a sus compañeros.
- **Área con un solo operador:** no hay con quién compararlo, así que no se calcula índice ni se genera alerta.
- Se compara solo dentro de la misma área.

> Nota: el umbral 1.5 y el mínimo de 3 son valores iniciales. Se ajustan con datos reales.

---

## 8. Periodos

| Periodo | Definición |
|---|---|
| **Jornada** | Un día de turno, de 00:00 a 23:59 del día seleccionado. |
| **Semana** | De lunes a domingo. |
| **Mes** | Del día 1 al último día del mes. |
| **Fecha específica** | Cualquier día que el coordinador elija. |

---

## 9. Dashboard General (coordinador)

Vista de situación, no de gestión. Sin tabla de tickets.

1. **KPIs del turno:** tickets activos, creados hoy, resueltos hoy, sin asignar, operadores disponibles / total.
2. **Alertas:** operadores en sobrecarga, tickets críticos sin asignar, tickets con más tiempo esperando.
3. **Carga por operador en tiempo real:** activos y estado de cada uno.
4. **Flujo del día:** curva de entradas por hora.

---

## 10. Sección Tickets (nueva)

Mesa de control del coordinador. Aquí se gestiona todo.

- Tabla con filtros: estado, prioridad, operador, área, fecha, antigüedad.
- Acciones: asignar, reasignar, definir prioridad y puntos, pausar, poner en espera de terceros, resolver, cerrar.
- **Asignación masiva:** se conserva. El coordinador puede seleccionar varios tickets y asignarlos a un operador a la vez.
  - Antes de confirmar, el sistema calcula la carga que tendría el operador después de la asignación.
  - Si esa asignación lo llevaría a **sobrecarga** (índice mayor a 1.5), se muestra un aviso claro: "Esta asignación dejará a [operador] con [N] tickets activos, por encima del umbral del área." El coordinador puede confirmar o cancelar.
  - El aviso no bloquea la acción; solo exige una confirmación consciente.
- Historial de cada ticket: quién lo tomó, cuándo cambió de estado y quién lo cerró.

### 10.1 Traspaso de casos al operador de guardia

Cuando el coordinador se retira y quedan casos sin resolver, puede **traspasarlos al operador de guardia** con una nota de contexto.

- El coordinador selecciona uno o varios tickets y los traspasa a un operador de guardia.
- Cada traspaso incluye una **nota de traspaso** obligatoria: qué se intentó, qué se hizo y qué sigue. Así el guardia sabe qué hacer sin tener que reconstruir el caso.
- El ticket queda asignado al guardia, con la nota visible en el detalle y en el historial.
- Los traspasos cuentan para la carga del guardia y aparecen como traspaso en los reportes.
- El traspaso no reinicia el tiempo de solución: el tiempo sigue contando desde que el ticket llegó al correo.

---

## 11. Reportes y plantilla Excel (v1)

Estructura propuesta, sujeta a ajuste posterior:

| Hoja | Contenido |
|---|---|
| **Resumen** | Periodo, área, totales de volumen, tiempo total y tiempo en horario, activos al cierre. |
| **Por área** | Creados, asignados, resueltos, cerrados, activos y tiempos promedio por área. |
| **Por operador** | Asignados, resueltos, activos, tiempos promedio e índice de carga por operador. |
| **Flujo horario** | Tickets recibidos por hora en el periodo. |
| **Detalle** | Listado de tickets: código, asunto, área, prioridad, puntos, operador, fechas de llegada, asignación, resolución y cierre, estado. |

---

## 12. Cambios de datos necesarios

> Estos cambios **no se han aplicado**. Requieren revisión antes de tocar `schema.prisma` y las migraciones.

1. **Reflejar el estado `RESUELTO` en `schema.prisma`.** El valor ya existe en la base de datos por la migración `20261006140000_add_resuelto_and_adjunto`, pero el enum `EstadoTicket` del schema no lo tiene, así que Prisma Client no lo conoce.
2. **Añadir `fecha_resuelto`** al modelo `Ticket`.
3. **Unificar** `resueltoEn` y `fecha_cierre`: hoy hacen casi lo mismo. Propuesta: `fecha_resuelto` para el operador y `fecha_cierre` para el coordinador.
4. **Sincronizar el modelo `Adjunto` con el schema.** La misma migración crea la tabla `Adjunto` (relacionada con `Ticket`), pero `schema.prisma` no la declara. No requiere una migración nueva, solo declarar el modelo.
   - *Nota:* `clave` y `EN_PAUSA` **sí** están en `schema.prisma`; una versión anterior de este documento decía lo contrario y era incorrecta.
   - *Pendiente de seguridad, distinto del schema:* `authController` compara la contraseña en texto plano (`user.clave !== clave`). Conviene guardar un hash (por ejemplo con bcrypt).
5. **Añadir horario por operador** (días de la semana y franja horaria, con tipo `TURNO` o `GUARDIA`).
6. **Añadir índice** sobre `createdAt`, `fecha_resuelto` y `fecha_cierre` para que los reportes por periodo sean rápidos.

---

## 13. Fuera de alcance (por ahora)

- Notificaciones por correo o WhatsApp al operador.
- Modo oscuro (la primera versión es en claro, estilo macOS).
- Sincronización en tiempo real (WebSocket). Se evalúa en fase posterior.

---

## 14. Preguntas abiertas

### Resueltas en esta versión

- **Umbral de sobrecarga:** 1.5 veces el promedio del área (ejemplo en la sección 7). Se ajusta con datos reales.
- **Quién cierra un ticket:** el coordinador de su área o el administrador general.
- **Guardia:** no aparece como disponible en la jornada normal; aparece como "De guardia", puede ser contactado y ver y resolver tickets desde casa.
- **Traspaso al guardia:** el coordinador puede traspasar casos con nota de contexto (sección 10.1).
- **Asignación al guardia:** el estado "De guardia" **no bloquea** la asignación. El coordinador puede asignarle tickets, porque cuando el coordinador se retira el guardia es quien atiende lo que queda pendiente.

### Pendientes

2. **Teléfono de guardia de Telefonía:** existe un teléfono de guardia en Telefonía. Queda por confirmar con el departamento si se guarda en el sistema o si el contacto será solo por correo. Se evalúa en una fase posterior.

---

## 13. Actualización (11-oct): editar, eliminar, resolver/cerrar y auditoría

**Estados.** El operador *resuelve* (`RESUELTO`, sella `resueltoEn`); el coordinador *cierra* (`CERRADO`, sella `fecha_cierre`). El tiempo de atención se mide de `createdAt` a `resueltoEn` (respaldo: `fecha_cierre` en cierres directos). Esto reemplaza los puntos 2–3 de §12: no se agrega ninguna columna nueva de fecha.

**Eliminar (solo coordinador).** Borrado lógico: `eliminado_en` + `motivo_eliminacion` (obligatorio). El ticket sale de listas y de **todas** las métricas, se desasigna y se puede restaurar desde la Papelera. Si estaba resuelto o cerrado, pide confirmación adicional. Los códigos INC-xxx nunca se reutilizan. No existe borrado definitivo en la interfaz.

**Editar (solo coordinador).** Editables: asunto, descripción, área y prioridad (puntos P1=8, P2=5, P3=1). Fijos: código, fecha de llegada y remitente. Cambiar el área de un ticket asignado a un operador de otra área exige confirmación.

**Auditoría.** Cada cierre, edición (valor anterior → nuevo), eliminación (con motivo) y restauración se guarda en `AuditLog`. Esta tabla no existía en `schema.prisma` ni en las migraciones aunque la pantalla de auditoría ya la consultaba; la migración `20261011010000_soft_delete_and_audit_log` la crea.

**Endpoints (coordinador):** `POST /api/tickets/:code/close`, `PATCH /api/tickets/:code` (asunto, descripcion, area_designada, prioridad, confirmarCambioArea), `DELETE /api/tickets/:code` (motivo, confirmar), `POST /api/tickets/:code/restore`. Respuestas con `requiereConfirmacion: true` y HTTP 409 cuando hace falta confirmar.

**Traspaso a guardia (implementado).** `POST /api/tickets/handoff` con `{ ticketCodes[], operatorId, nota }` (nota obligatoria, mínimo 10 caracteres). Reasigna al operador elegido, conserva la `fecha_asignacion` original y no toca `createdAt`, así que el tiempo de atención sigue contando desde la llegada. No admite tickets resueltos o cerrados. Cada traspaso queda en `AuditLog` (`TICKET_TRASPASADO_GUARDIA`, con "De → A" y la nota). La rotación semanal de guardias (quién es el guardia) sigue pendiente; por ahora el coordinador elige al operador.

**Otros endpoints (coordinador):** `GET /api/tickets/trash` (papelera) y `GET /api/tickets/:code/history` (historial con notas, para el detalle del ticket).

**Dashboard.** El controlador entrega `flujoHoy = { creados[24], cerrados[24] }`, ya en hora de Caracas, solo con el día de hoy y con el cierre medido por `resueltoEn`. La vista solo lo dibuja; no debe recalcular horas ni leer todos los tickets.

**Reportes por periodo y Excel (implementado).** `GET /reportes/data` y `GET /reportes/excel` (ver `docs/contrato-metricas.md`). El Excel quedó en cuatro hojas (Resumen Ejecutivo con el balance por área, Productividad Operadores, Flujo Horario, Detalle de Tickets), con el estilo del reporte gerencial anterior; reemplaza la tabla de §11. Agrega puntos, distribución por prioridad, % de participación, estado de carga y lecturas clave. "Tiempo en horario" usa, por ahora, lunes a viernes de 8:00 a 17:00 (Caracas) para todos; cuando exista el horario por operador (§12, punto 5) se calculará con el de cada uno.
