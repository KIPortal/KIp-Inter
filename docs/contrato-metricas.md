# Contrato de reportes por periodo

Para Antigravity y cualquier vista que consuma los reportes. Solo rol **COORDINADOR** (sesión iniciada); un operador recibe 403.

## Endpoints

| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/reportes/data` | JSON con las 5 secciones |
| GET | `/reportes/excel` | Archivo `.xlsx` (descarga) |

(`/reports/...` funciona igual.)

### Parámetros (query string)

| Parámetro | Valores | Notas |
|---|---|---|
| `periodo` | `jornada` (por defecto), `semana`, `mes`, `especifica` | Coinciden con las opciones de `#periodoSelect`. |
| `fecha` | `AAAA-MM-DD` | Fecha de Caracas. **Obligatoria** con `especifica`; opcional en los demás (sin ella se usa hoy). La semana y el mes se calculan alrededor de esa fecha. |
| `area` | `GENERAL`, `REDES_FTTH`, `TRAFICO_INALAMBRICO`, `WAN`, `GRANDES_CLIENTES`, `SEGURIDAD`, `TELEFONIA` | Opcional. Sin él se incluyen todas. |

Periodos: **jornada** = el día completo (00:00 a 23:59, Caracas); **semana** = lunes a domingo; **mes** = día 1 al último; **especifica** = el día elegido.

Errores: HTTP 400 `{ "success": false, "error": "..." }` si el periodo, la fecha o el área no son válidos.

## Respuesta de `/reportes/data`

```jsonc
{
  "success": true,
  "resumen": {
    "periodo": "semana", "desde": "2026-10-05", "hasta": "2026-10-11", "etiqueta": "2026-10-05 a 2026-10-11",
    "area": "Todas",                 // o el nombre del área
    "creados": 0, "asignados": 0, "resueltos": 0, "cerrados": 0,
    "activos": 0,                    // por revisar AL MOMENTO de consultar (no depende del periodo)
    "tiempoTotalMin": 120.0,         // promedio en minutos; null si no hay resueltos
    "tiempoTotal": "2 h",            // texto listo para mostrar ("N/A" si no hay datos)
    "tiempoHorarioMin": 120.0,
    "tiempoHorario": "2 h"
  },
  "porArea": [ { "area": "WAN", "nombre": "WAN", "creados": 0, "asignados": 0, "resueltos": 0, "cerrados": 0, "activos": 0,
                 "tiempoTotalMin": null, "tiempoTotal": "N/A", "tiempoHorarioMin": null, "tiempoHorario": "N/A" } ],
  "porOperador": [ { "id": "...", "nombre": "...", "area": "WAN", "areaNombre": "WAN", "asignados": 0, "resueltos": 0,
                     "activos": 0,           // carga actual
                     "tiempoTotalMin": null, "tiempoTotal": "N/A", "tiempoHorarioMin": null, "tiempoHorario": "N/A",
                     "indiceCarga": 1.75,    // null si el área tiene un solo operador
                     "sobrecarga": true } ],
  "flujoHorario": [ { "hora": 0, "etiqueta": "00:00", "recibidos": 0 } ],   // 24 elementos, hora de Caracas
  "detalle": [ { "codigo": "INC-001", "asunto": "...", "area": "WAN", "prioridad": "P1|P2|P3|Sin prioridad", "puntos": 8,
                 "operador": "Nombre|Sin asignar", "estado": "Nuevo|En progreso|En pausa|En espera de terceros|Resuelto|Cerrado",
                 "llegada": "ISO", "asignacion": "ISO|null", "resolucion": "ISO|null", "cierre": "ISO|null" } ]
}
```

## Definiciones

- **Tiempo total:** promedio (suma ÷ cantidad, no mediana) de *resolución − llegada* de los tickets resueltos en el periodo.
- **Tiempo en horario:** lo mismo pero contando solo lunes a viernes de 8:00 a 17:00 (hora de Caracas). Cuando exista el horario por operador se reemplaza esta ventana fija.
- **Resueltos:** tickets cuyo `resueltoEn` (o, si falta, `fecha_cierre`) cae en el periodo. **Cerrados:** `fecha_cierre` en el periodo.
- **Activos:** Nuevo, En progreso, En pausa y En espera de terceros. Resuelto (esperando cierre) y Cerrado no cuentan.
- **Detalle:** tickets con algún evento en el periodo más todos los activos. Los eliminados (papelera) nunca aparecen.
- **Índice de carga y sobrecarga:** reglas de la especificación §7; se calculan con la carga actual, aunque el periodo sea pasado, y siempre contra el área completa aunque se filtre.
- **Por operador, asignados:** cuenta los tickets que hoy tiene el operador y cuya asignación cayó en el periodo (una reasignación posterior mueve el ticket a la cuenta del nuevo operador).

## Uso en la vista

```js
const q = new URLSearchParams({ periodo, ...(fecha && { fecha }), ...(area && { area }) });
const data = await (await fetch(`/reportes/data?${q}`)).json();
// Descarga: window.location.href = `/reportes/excel?${q}`;
```

El Excel tiene cinco hojas: **Resumen**, **Por área**, **Por operador**, **Flujo horario** y **Detalle**. Las fechas salen en hora de Caracas.
