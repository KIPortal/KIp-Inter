# Estructura propuesta del portal (insumo para el rediseño)

Define **qué va en cada pantalla**. El aspecto visual se decide después (Claude Design) y se implementa en las vistas EJS conectadas a `docs/contrato-metricas.md`. Estilo base: macOS plano (tarjetas blancas, borde `#E5E5EA`, azul `#007AFF`, texto 11–13 px).

## 1. Dashboard General — toda la estadística
Pantalla de monitoreo: cómo va la operación **hoy** y por qué.
- **Fila de tarjetas (KPI):** Tickets activos · Creados hoy · Resueltos/cerrados hoy · Promedio de atención · Críticos sin asignar · Operadores disponibles / en guardia.
- **Alertas de sobrecarga** (operador, activos, promedio del área, índice).
- **Flujo por hora de hoy:** creados, asignados y cerrados (24 h, Caracas).
- **Carga activa por área** (barras) y **saturación por área** (% de tickets aún abiertos).
- **Promedio de tiempo de resolución por área** (en horas).
- **Ranking de operadores:** puntos, tickets por prioridad (P1/P2/P3), índice de carga, estado de turno.
- **Equipo y turno:** quién está en turno, de guardia o fuera de turno.
- **Geografía** (mapa de Venezuela), si se conserva.

Fuente de datos: el controlador del dashboard (`dashboardController`) y `/reportes/data?periodo=jornada` para las gráficas.

## 2. Tickets — gestión y cola (con tarjetas)
Pantalla de trabajo del coordinador.
- **Tarjetas resumen arriba (siempre visibles):** Activos · Sin asignar · Críticos (P1) sin asignar · En pausa / en espera · Resueltos pendientes de cierre · Creados hoy.
- **Tabla de tickets** con filtros (área, fecha, prioridad, estado, operador), selección múltiple y acciones: asignar, desasignar, cerrar, editar, eliminar, traspasar a guardia, historial.
- **Papelera** (restaurar) y **Nuevo ticket**.
- Sin gráficas: eso queda en el Dashboard General.

## 3. Reportes — datos generales por periodo
Pantalla de consulta e informes, no de monitoreo en vivo.
- **Selector de periodo:** Jornada · Semana · Mes · Fecha específica (+ filtro de área).
- **Resumen del periodo:** creados, asignados, resueltos, cerrados, activos, puntos, tiempo total y tiempo en horario.
- **Tabla de detalle de tickets** del periodo y **tabla por operador** (puntos, P1/P2/P3, carga).
- **Descargar Excel** (4 hojas).
- Sin gráficas pesadas; solo lo necesario para leer el periodo.

## 4. Gestión de Turno
Guardia semanal (casillas por operador), horario individual (días y horas) y estado de turno actual.

## 5. Auditoría
Registro de acciones (cerrar, editar, eliminar, restaurar, traspaso, guardia, horarios).

## Qué se mueve respecto a hoy
| Contenido | Hoy | Propuesta |
|---|---|---|
| Flujo horario 24 h | Reportes y Dashboard | Dashboard General |
| Área vs tickets / saturación | Reportes | Dashboard General |
| Promedio de resolución por área | Reportes | Dashboard General |
| Ranking de operadores | Reportes → Equipo | Dashboard General |
| Mapa de Venezuela | Reportes → Geografía | Dashboard General (o se elimina) |
| Tarjetas de resumen | Dashboard | Dashboard **y** Tickets (con sus propias métricas) |
| Resumen, detalle y Excel | Reportes | Reportes (sin cambios) |

## Decisiones tomadas
1. **Mapa de Venezuela:** se conserva (gráfica importante a futuro). Va en el Dashboard General.
2. **Tickets — Resumen Operativo (regla de orden y filtro):**
   - Por defecto muestra solo tickets **activos**; los **cerrados no aparecen** (se ven con el filtro Estado = Cerrado o en una vista aparte).
   - Orden fijo por estado: **Nuevos → En progreso → En pausa → En espera → Resueltos (pendientes de cierre)**. Dentro de cada grupo: prioridad (P1 primero) y luego antigüedad.
   - Un ticket que se cierra sale de la lista principal.
   - Las **tarjetas** de arriba muestran siempre el total de la operación; no cambian con los filtros de la tabla. (Supuesto: confirmar.)
3. **Operador y coordinador tienen dashboards distintos y cada uno conserva el suyo.** Este rediseño cubre primero el del coordinador; el del operador se diseña aparte.

## Pendiente de confirmar
- ¿Las tarjetas de Tickets deben mantenerse fijas (propuesta) o seguir los filtros de la tabla?
