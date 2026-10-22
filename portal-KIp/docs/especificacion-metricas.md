
## 14. Turnos y guardias

Horario normal por defecto lun–vie 8:00–17:00 (Caracas), editable por operador (`HorarioOperador`). La guardia se define por semana (`GuardiaSemanal`) desde "Gestión de Turno". Lógica en `src/services/shiftService.js`; endpoints en `docs/contrato-metricas.md`.

## 15. Metas de Reportes

Editables en Administración → Reglas → "Metas de Reportes" (se guardan en `Configuracion.reglas.metas`). Por defecto: **93 %** de casos resueltos (resueltos ÷ recibidos en el periodo) y **4 h** de tiempo promedio de resolución (desde la llegada). En Reportes se marca en ámbar el % por debajo de la meta y el promedio por encima; el % que cumple va en verde.

"Carga ahora" por área (Reportes → Casos por área) no usa una capacidad fija por operador: la barra es activos por operador relativa al área más cargada, y el color sigue la regla de sobrecarga (por puntos activos acumulados: más de 1.5× el promedio de puntos del área, con al menos 3 activos) (rojo = alguien en sobrecarga, azul = normal, gris = sin operadores o sin comparación).

## 16. Puntos por nivel de dificultad (tipos de caso)

Decidido el 2026-10-22 con los Excel "Actividades Soporte FTTX" e "Indicadores Puntos y Niveles WAN":

- Cada área tiene un catálogo de **tipos de caso** (casos comunes) en Administración → Tipos de caso: nombre, nivel de dificultad (1 más sencillo … 4 muy complejo), tiempo de resolución estimado (min), frecuencia declarada (Alta/Media/Baja) y dependencias (otras áreas o proveedores). Se desactivan, no se borran.
- **Los puntos de un ticket salen de su nivel:** N1 = 2, N2 = 4, N3 = 8, N4 = 10. Suman a la carga de quien lo resuelve y de su área (Reportes, Dashboard, "puntos hoy").
- **La prioridad (P1/P2/P3) ya no da puntos:** queda solo como urgencia (orden de la cola, alertas de antigüedad, "críticos sin asignar" = P1 y P2). Va en `Ticket.prioridad`.
- Quien toma un ticket sin tipo lo elige (como la prioridad); si no está en el catálogo, elige "Otro" con su nivel. El coordinador puede corregirlo al editar el ticket.
- El nivel y los puntos se guardan en el ticket al clasificarlo: si luego cambia el catálogo, el historial no cambia. Los tickets anteriores a este cambio conservan sus puntos de antes (8/5/1) y su prioridad se dedujo de ellos.
- **Casos comunes** (Reportes → Casos comunes y hoja del Excel): por tipo de caso, veces recibido en el periodo (y % de los casos con tipo), tasa por día, resueltos, puntos y tiempo promedio real **desde la llegada** frente al estimado del catálogo (en naranja si lo supera). Los "Otro" se agrupan por área y nivel; los tickets sin tipo se cuentan aparte. Lógica en `src/services/tipoCasoService.js`.

