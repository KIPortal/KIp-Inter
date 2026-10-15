# Guía para colaboradores

Bienvenido. Esta guía es para quien llega nuevo al Portal KIp: cómo levantarlo en tu equipo, cómo está organizado y cómo se hicieron sus partes principales. El proyecto es de **Jose Corobo (Jacu)** y se rige por la licencia del [LICENSE](../LICENSE): puedes estudiarlo y proponer cambios, pero no copiarlo ni publicarlo fuera de este repositorio.

## 1. Requisitos

- **Node.js 20 o superior** (se desarrolla con Node 22) y npm.
- **Git**.
- Una base de datos **PostgreSQL**. El proyecto usa Supabase (el plan gratuito sirve). No uses la base de producción: crea tu propio proyecto.
- Los comandos de esta guía son de **PowerShell en Windows**; en macOS o Linux son equivalentes (`cp` en vez de `Copy-Item`).

## 2. Instalación paso a paso

```powershell
git clone https://github.com/joseacorobo/KIp-Inter.git
cd KIp-Inter\portal-KIp
npm install
Copy-Item .env.example .env
```

### 2.1 Configurar el `.env`

El archivo `.env` vive en `portal-KIp/` y **nunca se sube a git** (está en `.gitignore`). Contiene la conexión que usa Prisma, el ORM del proyecto, para hablar con la base de datos.

En Supabase: *Project Settings > Database > Connection string*, y copia:

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | Conexión por el *pooler* en modo transacción (puerto 6543, con `?pgbouncer=true`). La usa la app. |
| `DIRECT_URL` | Conexión en modo sesión (puerto 5432). La usan las migraciones. |
| `SESSION_SECRET` | Cadena larga y aleatoria para firmar la sesión. Obligatoria si `NODE_ENV=production`. |
| `GRAPH_*` | Solo si quieres probar la ingesta de correos (ver `portal-KIp/docs/GRAPH_API_SETUP.md`). Sin ellas el portal funciona; simplemente no lee correos. |

### 2.2 Crear las tablas

Las migraciones están escritas a mano en `portal-KIp/prisma/migrations/`. Aplícalas y genera el cliente de Prisma:

```powershell
npx prisma migrate deploy
npx prisma generate
```

> Regla del proyecto: **no se ejecuta SQL a mano en la base**. Todo cambio de estructura es una migración nueva en `prisma/migrations/` y se aplica con `migrate deploy`.

### 2.3 Primer usuario y datos de prueba

No hay *seed*. Crea el primer coordinador:

```powershell
node scripts/crear-admin.js --email=tu@correo.com --nombre="Tu Nombre" --clave=TuClave1
```

Para tener una jornada de ejemplo con operadores y tickets (marcados `SIM-xxx` y `@demo.local`):

```powershell
node scripts/simular-jornada.js --fecha=2026-10-15 --tickets=40
node scripts/limpiar-simulacion.js --confirmar   # la borra
```

### 2.4 Arrancar

```powershell
npm run dev     # con recarga automática (nodemon)
npm start       # sin recarga
```

Abre `http://localhost:3000` e inicia sesión con el usuario que creaste.

> Aviso: el endurecimiento del login (claves cifradas, sin acceso de desarrollo) está en la rama `feat/seguridad-login`, aún sin fusionar. Mientras tanto, en tu equipo de pruebas está bien; no lo expongas a internet. Detalle en `docs/pendientes.md`.

## 3. Cómo está organizado

```
KIp-Inter/
├── CLAUDE.md                 Contexto y reglas para los agentes de IA (léelo: resume todo)
├── docs/                     Especificación de métricas, contrato de endpoints y pendientes
└── portal-KIp/
    ├── server.js             Arranque del servidor
    ├── prisma/               schema.prisma + migraciones escritas a mano
    ├── src/
    │   ├── app.js            Express: sesión, rutas, ingesta de correos
    │   ├── routes/           Una ruta por pantalla (tickets, turno, reportes, admin…)
    │   ├── controllers/      Leen la petición, llaman servicios y entregan datos a la vista
    │   ├── services/         Toda la lógica de negocio, en funciones puras
    │   ├── middlewares/      Sesión, roles, límite por área, subida de archivos
    │   └── config/prisma.js  Cliente de Prisma (con borrado lógico)
    ├── views/                Plantillas EJS: solo dibujan lo que manda el controlador
    ├── public/               CSS y JS del navegador (sin framework)
    └── scripts/              Utilidades de datos y pruebas test-*.js
```

**La regla de oro:** la lógica va en `src/services/`, los controladores solo orquestan y las vistas solo dibujan. Así casi todo se puede probar sin navegador ni base de datos.

## 4. Conceptos del negocio

Antes de tocar métricas, lee `docs/especificacion-metricas.md` y `docs/contrato-metricas.md`. Lo esencial:

- **Ticket:** llega por correo (o se crea a mano), recibe un código `INC-xxx` que nunca se reutiliza, y pasa por estados hasta RESUELTO (lo marca el operador) y CERRADO (lo cierra el coordinador).
- **Prioridad y puntos:** los fija el coordinador. P1 = 8, P2 = 5, P3 = 1, sin prioridad = 0. Los puntos miden la carga.
- **Roles:** OPERADOR, COORDINADOR (todas las áreas), JEFE (solo su área) y GERENTE (todas las áreas, administra roles). Todo pasa por `roleService`; nunca se compara `rol === 'COORDINADOR'` a secas.
- **Áreas y subgrupos:** son tablas (`Area`, `Subgrupo`), no listas fijas. Se leen del catálogo vivo `areaCatalog.js`.
- **Turno y guardia:** turno normal 8:00–17:00 de lunes a viernes; la guardia es por día (`GuardiaDia`). Zona horaria de Caracas (UTC-4).
- **Sobrecarga:** un operador con más de 1.5 veces los tickets activos del promedio de su área (mínimo 3).
- **Borrado lógico:** nada se borra de verdad; va a la papelera con motivo y queda en la auditoría.

## 5. Cómo se hicieron las partes principales

| Parte | Dónde está | Cómo funciona |
|---|---|---|
| **Ingesta de correos** | `emailIngestionService.js` | Cada 2 minutos (node-cron) lee un buzón con Microsoft Graph, crea un ticket por correo nuevo y, si el asunto trae un `INC-xxx`, lo agrega como respuesta al ticket existente. |
| **Códigos INC** | `ticketCodeService.js` | Toma el siguiente número incluyendo los tickets borrados (`prisma.INCLUDE_DELETED`), para no repetir nunca un código. |
| **Cola y asignación** | `ticketQueueService.js`, `assignmentService.js`, `rulesService.js` | Ordenan los entrantes por prioridad y antigüedad y deciden a quién se puede asignar según área, subgrupo, turno y carga. |
| **Métricas** | `metricsService.js`, `dashboardService.js` | Tiempos medidos desde la llegada del ticket, con promedio. Carga por puntos y detección de sobrecarga. |
| **Turnos y guardias** | `shiftService.js`, `shiftBoardService.js` | Calculan quién está en turno, de guardia o ausente en cada momento, y el traspaso a guardia con nota. |
| **Reportes y Excel** | `periodReportService.js`, `reportViewService.js`, `excelExportService.js` | Resumen por semana o periodo y exportación a Excel con exceljs. |
| **Conversación del ticket** | `conversationService.js` | Hilo de mensajes y adjuntos de cada caso, con respuesta al cliente por correo. |
| **Panel del operador** | `operatorPanelService.js`, `public/js/operador.js` | "Mi panel": entrantes, mis casos y detalle con pestañas. |
| **Administración y auditoría** | `userAdminService.js`, `configService.js`, `auditViewService.js` | Usuarios, roles, áreas, subgrupos, avisos y el registro de todo cambio. |
| **Simulación** | `simulationService.js`, `scripts/simular-jornada.js` | Genera una jornada realista para probar y hacer demos sin datos reales. |
| **Diseño** | `docs/rediseno/` | Prototipo, tokens de color claro/oscuro y la guía por fases con la que se rediseñaron las pantallas. |

### Cómo se trabajó

El portal se construyó por fases durante varias semanas, combinando investigación propia con agentes de IA: Claude para el backend, el esquema y las pruebas; Antigravity (Gemini) para las primeras vistas; y Claude Design para el rediseño actual. Cada fase quedó en su rama y entró a `main` por pull request. `CLAUDE.md` es el documento que mantiene a los agentes alineados con las reglas del negocio; es una buena lectura para entender las decisiones.

## 6. Pruebas

No hay framework ni base de datos real: los scripts `scripts/test-*.js` simulan Prisma y usan `assert`. Córrelas todas antes de proponer un cambio:

```powershell
npm run test:metrics; npm run test:tickets; npm run test:period; npm run test:shifts
npm run test:simulation; npm run test:dashboard; npm run test:queue; npm run test:assignment
npm run test:turno; npm run test:admin; npm run test:audit; npm run test:report-view
npm run test:usuarios; npm run test:areas; npm run test:conversacion; npm run test:operador
npm run test:roles; npm run test:ui
```

## 7. Cómo proponer un cambio

1. Crea una rama desde `main` (`feat/...` o `fix/...`).
2. Haz el cambio respetando la regla de oro y las reglas del negocio de `CLAUDE.md`. Si cambias la estructura de la base, agrega una migración nueva.
3. Corre todas las pruebas.
4. Abre un pull request hacia `main` explicando qué cambia. Jacu lo revisa y decide si entra.

Nunca subas tu `.env`, claves ni datos reales de personas o clientes.
