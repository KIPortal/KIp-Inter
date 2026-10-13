# Portal KIp — contexto para Claude

Portal de tickets y estadísticas del depto. **Operaciones IP** (Inter Telecomunicaciones). Mide y reparte la carga de trabajo de los operadores. Código en `portal-KIp/` (Node + Express 5, Prisma 5.22/PostgreSQL en Supabase, vistas EJS, JS sin framework, Tailwind, ECharts, exceljs). Idioma del proyecto y del usuario: español.

## Usuario y forma de trabajo
- El usuario es Jacu (estudiante, pasantía). Tiene plan Claude Pro: **economiza tokens y avisa qué modelo vas a usar antes de usarlo o cambiarlo**.
- Tono cercano y directo, respuestas escaneables. Cuando haya que darle instrucciones para otro agente (Antigravity), sé muy específico: archivos, endpoints y pasos exactos.
- Los comandos que él ejecuta son de **PowerShell en Windows**. No ejecutes SQL a mano en la base: solo migraciones de Prisma.

## Reglas de negocio (no cambiar sin preguntar)
- Tiempo medido desde la llegada del ticket; se usa **promedio**, no mediana. No usar las palabras "SLA" ni "DERS".
- Prioridad y puntos los fija el coordinador: P1=8, P2=5, P3=1, sin prioridad=0.
- El operador resuelve (RESUELTO); el coordinador cierra (CERRADO).
- Sobrecarga: tickets activos > 1.5× el promedio del área (mínimo 3; ausentes excluidos; un solo operador = sin comparación).
- Zona horaria Caracas (UTC-4). Semana lunes–domingo. Turno normal 8:00–17:00 (lun–vie por defecto, editable por operador).
- Guardia (rota por semana, la define el coordinador): 17:00–24:00 entre semana; 08:00–24:00 en fin de semana desde casa. El de guardia aparece "De guardia", no "Disponible", pero puede recibir tickets. El traspaso a guardia exige nota (≥10 caracteres).
- Borrado lógico: eliminar = papelera (con motivo ≥3 caracteres) + auditoría. Los códigos INC-xxx nunca se reutilizan (`prisma.INCLUDE_DELETED`). Primer ticket: INC-001.

## Documentos (leer antes de tocar métricas o endpoints)
- `portal-KIp/docs/especificacion-metricas.md` — reglas y definiciones.
- `portal-KIp/docs/contrato-metricas.md` — endpoints y campos que consumen las vistas.
- `portal-KIp/docs/pendientes.md` — pendientes (incluye la seguridad del login aplazada).

## Arquitectura
- Lógica pura en `src/services/` (metricsService, periodReportService, excelExportService, shiftService, simulationService); controladores en `src/controllers/`; las vistas solo dibujan lo que entrega el controlador.
- Los ids de usuario son **UUID (texto)**, nunca números.

## Pruebas (sin framework, sin base de datos real)
Scripts `scripts/test-*.js` con `assert`; en `package.json`: `test:metrics`, `test:reports`, `test:tickets`, `test:period`, `test:shifts`, `test:simulation`, `test:dashboard`, `test:queue`. La UI tiene `scripts/test-phase-a-ui.js`. Corre todas antes de dar algo por terminado. Estas pruebas simulan Prisma: no prueban la base real.

## Base de datos
- Las migraciones están escritas a mano en `prisma/migrations/`; el usuario las aplica con `npx prisma migrate deploy` y luego `npx prisma generate`.
- Datos: `npm run datos:cero` (borra tickets y operadores; conserva coordinadores), `node scripts/simular-jornada.js --fecha=AAAA-MM-DD --tickets=N` (demo marcada SIM-xxx / @demo.local), `node scripts/limpiar-simulacion.js --confirmar`, `node scripts/crear-admin.js` (primer coordinador). Ya no existe seed.

## Ramas y git
- `main` (estable), `feat/metricas-fase-a` (backend/schema), `feat/ui-fase-a` (vistas), `feat/seguridad-login` (login aplazado; NO fusionar aún: hash de claves, quitar el log de login, bloquear el acceso de desarrollo).
- Commits terminan con las líneas `Co-Authored-By` que indique el entorno. Usa `git merge ... --no-edit`.
- Reparto: el backend/schema lo hace Claude; las vistas las hacía Antigravity (Gemini) y ahora se rediseñan con Claude Design y se implementan con Claude.

## Pendientes conocidos
- Rediseño del Dashboard General y de la sección Tickets (se hará con Claude Design).
- Telefonía: dónde guardar el teléfono de guardia.
- "Tiempo en horario" usa una ventana fija lun–vie 8–17 (aún no usa horarios por operador).
- Seguridad del login (ver `docs/pendientes.md`).
