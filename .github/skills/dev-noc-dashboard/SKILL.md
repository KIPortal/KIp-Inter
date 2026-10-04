---
name: dev-noc-dashboard
description: 'Desarrolla y mantiene el portal NOC para coordinadores con Node.js, Express, Prisma, PostgreSQL, EJS y Tailwind. Úsala para cambios de tickets, operadores, SLA, métricas, vistas, estilos Figma/Stitch, endpoints REST, depuración y validación del dashboard.'
argument-hint: 'Describe el cambio o problema del portal NOC y la vista o flujo afectado.'
---

# Desarrollo del Dashboard NOC

## Objetivo

Implementa cambios pequeños y coherentes en el portal NOC para coordinadores. Sigue la arquitectura y las convenciones del repositorio; conserva los contratos existentes salvo que el requisito pida cambiarlos.

## Cuándo usar

- Añadir o corregir flujos de tickets, asignación, operadores, métricas o SLA.
- Modificar rutas Express, lógica de negocio, consultas Prisma o vistas EJS.
- Integrar acciones masivas, modales, estilos Tailwind o assets exportados desde Figma/Stitch.
- Investigar errores de render, respuestas REST, persistencia o presentación del dashboard.

## Flujo de trabajo

1. **Ubica el comportamiento.** Lee las instrucciones del repositorio y sigue el flujo implicado desde la ruta hasta el controlador/servicio, Prisma y la vista EJS o el JavaScript que la activa. Revisa los tests o llamadas cercanas. Formula una hipótesis concreta y una comprobación económica antes de editar.
2. **Verifica el modelo vigente.** Inspecciona `portal-KIp/prisma/schema.prisma` y los controladores antes de asumir nombres de campos, estados o relaciones. Las reglas de negocio de esta skill son el objetivo funcional, pero cualquier diferencia con el esquema existente se debe identificar y resolver consistentemente en esquema, migración, backend y frontend. No inventes una segunda representación del mismo dato.
3. **Haz el cambio mínimo en la capa propietaria.** Mantén validación y reglas de negocio en Express/backend; usa Prisma para toda lectura y escritura de PostgreSQL; deja en EJS la estructura y presentación, y en JavaScript del navegador la interacción de la vista.
4. **Valida el flujo afectado.** Ejecuta primero el test, comprobación HTTP, build o chequeo más pequeño que pueda refutar el cambio. En flujos de vista, comprueba que EJS renderiza y que la respuesta no contiene errores del servidor; en mutaciones, verifica respuesta y persistencia si hay una comprobación local disponible. Después amplía a las verificaciones requeridas por el cambio.
5. **Cierra con evidencia.** Resume archivos y comportamiento modificados, verificaciones ejecutadas y cualquier limitación o inconsistencia preexistente que no se haya podido resolver.

## Reglas de datos y negocio

- **PostgreSQL se gestiona exclusivamente con Prisma ORM.** No añadas consultas SQL directas ni mecanismos paralelos de acceso a la base de datos. Cambios de esquema deben usar el flujo de migraciones de Prisma del repositorio.
- **Un único registro por ticket durante su ciclo de vida.** Cambia el estado del ticket existente; no crees tablas de históricos como `tickets_realizados` para representar cierres. Usa relaciones o registros de auditoría solo si el requisito lo necesita y sin duplicar el ciclo de vida.
- **Estados del ticket:** la regla funcional solicitada contempla `NUEVO`, `EN_PROGRESO` y `REALIZADO`, pero el esquema vigente puede usar `CERRADO`. No asumas que `CERRADO` y `REALIZADO` son equivalentes, ni migres o cambies el enum por iniciativa propia. Si la tarea depende de esa diferencia, pregunta si se debe conservar el estado vigente o migrar al nombre solicitado; implementa solo después de resolverlo y actualiza todas las capas de forma consistente.
- **SLA de resolución:** establece `resueltoEn` al cerrar/resolver el ticket y usa ese sello para calcular duración. No uses `updatedAt` para métricas de SLA: auditorías y ediciones posteriores pueden alterarlo. El sello se fija en la transición válida a estado final, siguiendo la zona horaria y formato del proyecto.
- **Personas dinámicas:** técnicos y operadores provienen de entidades relacionales consultadas en backend. No quemes nombres u opciones de operadores en EJS, JavaScript o CSS. El esquema vigente usa `User` para estos registros: conserva ese modelo y sus relaciones; no lo renombres ni añadas un modelo `Operador` dedicado salvo que una tarea lo solicite explícitamente.
- Valida identificadores, estados y permisos en el servidor; no confíes en los datos enviados por el navegador. Para cambios masivos, aplica filtros y transiciones válidas en Prisma, devuelve resultados claros y evita que una selección vacía o inválida afecte registros inesperados.

## Backend y contratos REST

- Usa Node.js con Express y conserva el patrón existente de rutas, controladores, servicios y middleware.
- Expón acciones mediante endpoints RESTful existentes o nuevos siguiendo sus convenciones. Valida entrada y autorización en el backend antes de ejecutar Prisma `update` o `updateMany`.
- Devuelve códigos HTTP y respuestas JSON consistentes con el proyecto. Maneja errores de validación, registros inexistentes y fallos de persistencia sin filtrar detalles sensibles.
- Para cierres y cambios de estado, realiza conjuntamente las actualizaciones relacionadas (por ejemplo, estado y `resueltoEn`) de modo que no queden parcialmente aplicadas.

## EJS, Tailwind y assets

- Usa EJS para componer la interfaz y Tailwind CSS para estilos conforme a la configuración existente. Mantén HTML, CSS y JavaScript legibles y consistentes con las vistas vecinas.
- La dirección visual es una interfaz NOC limpia, técnica y cuidada, inspirada en macOS: fondos claros, jerarquía sobria, sombras suaves y métricas alineadas con `tabular-nums`. Usa la fuente y los tokens disponibles en el proyecto; no introduzcas dependencias visuales innecesarias.
- Al integrar CSS exportado de Figma o Stitch, no pegues exports crudos que dependan de `position: absolute` y rompan el diseño adaptable. Filtra y organiza las reglas en la carpeta de assets existente (`portal-KIp/views/components/assets/`); usa `@apply` con utilidades Tailwind cuando encaje con el pipeline del proyecto. Comprueba que el CSS resultante se compila y conserva el comportamiento responsive.
- No agregues estilos inline ni duplicados si el asset compartido o los componentes existentes son el lugar adecuado. No sacrifiques accesibilidad ni estados de foco por fidelidad visual.

## Interacciones del navegador

- Implementa modales y acciones masivas en las vistas EJS con JavaScript vanilla y manipulación del DOM, de acuerdo con la estructura existente.
- Envía cambios al backend mediante Fetch API a endpoints RESTful. Presenta estados de carga, éxito y error; evita doble envío y mantén la interfaz sincronizada con la respuesta del servidor.
- Para operaciones por lotes, envía identificadores y valores explícitos, confirma acciones destructivas cuando corresponda y procesa errores parciales si el endpoint puede producirlos.

## Criterios de finalización

- La solución respeta el esquema Prisma real y no crea tablas de histórico para tickets.
- El SLA usa `resueltoEn`; los operadores se cargan desde datos relacionales.
- Las mutaciones se validan y persisten vía Express y Prisma; las interacciones de página usan Fetch API cuando corresponde.
- Las vistas EJS renderizan sin errores, los assets no rompen el layout adaptable y los estilos pasan por el pipeline existente.
- Se ejecutó una comprobación enfocada y se reportan claramente resultados y verificaciones pendientes.
