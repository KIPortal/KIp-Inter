
## 14. Turnos y guardias

Horario normal por defecto lun–vie 8:00–17:00 (Caracas), editable por operador (`HorarioOperador`). La guardia se define por semana (`GuardiaSemanal`) desde "Gestión de Turno". Lógica en `src/services/shiftService.js`; endpoints en `docs/contrato-metricas.md`.

## 15. Metas de Reportes

Editables en Administración → Reglas → "Metas de Reportes" (se guardan en `Configuracion.reglas.metas`). Por defecto: **93 %** de casos resueltos (resueltos ÷ recibidos en el periodo) y **4 h** de tiempo promedio de resolución (desde la llegada). En Reportes se marca en ámbar el % por debajo de la meta y el promedio por encima; el % que cumple va en verde.

"Carga ahora" por área (Reportes → Casos por área) no usa una capacidad fija por operador: la barra es activos por operador relativa al área más cargada, y el color sigue la regla de sobrecarga (rojo = alguien en sobrecarga, azul = normal, gris = sin operadores o sin comparación).
