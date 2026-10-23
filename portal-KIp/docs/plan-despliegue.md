# Plan de despliegue de prueba (2026-10-23)

Objetivo: dejar el portal en un servidor de prueba, con usuarios reales de un área piloto y, si se puede, un buzón real que cree tickets.

## Lo que bloquea hoy
- **Claves en texto plano** y `authController.js` imprime `req.body` en cada login (la clave queda en los logs). El arreglo con scrypt (`5279b3c`) se aplazó en `1802144`; `feat/seguridad-login` va 122 commits atrás de `main`: rehacerlo sobre `main`, no fusionarla.
- **Sesiones en memoria** (MemoryStore): cada reinicio cierra la sesión de todos.
- **Archivos en disco**: `fotos-perfil/` y `registros/jornadas/` necesitan disco persistente.
- **Procesos fijos**: cierre de jornada 00:05 y revisión del buzón cada 30 s → servidor siempre encendido (no serverless ni planes gratis que se duermen).
- `trust proxy` fijo en `'loopback'`: detrás de un proxy externo falla la cookie `secure`.

## Fases

### F0 · Decisiones (sin código)
- Hosting: servidor interno de TI (preferido: datos de empleados) o nube (Railway/Render con disco).
- Base de prueba: proyecto Supabase aparte del de desarrollo.
- Dominio/IP y quiénes prueban (área piloto y cuántas personas).
- Correo en la prueba: ver "Evaluación: correo real sin TI".

### F1 · Seguridad mínima del login (bloqueante)
- Rama `feat/despliegue-prueba` desde `main`.
- scrypt en login y en `profileController.changePassword`; migración de claves existentes (cifrar al primer login correcto o forzar cambio: por decidir).
- Quitar el log del login; acceso de desarrollo apagado con `NODE_ENV=production`.
- Límite básico de intentos fallidos.

### F2 · App lista para producción
- Sesiones en Postgres (tabla nueva por migración de Prisma).
- `trust proxy` por variable de entorno; ruta `/salud`.
- Validar variables obligatorias al arrancar.
- `build:assets` como paso de build, no en `start`.
- `FOTOS_DIR` / `REGISTROS_DIR` al disco persistente.
- Correr todas las pruebas `test:*`.

### F3 · Base de datos de prueba
- `npx prisma migrate deploy` y `npx prisma generate` contra la base nueva.
- `node scripts/crear-admin.js` (primer coordinador).
- Cargar áreas, subgrupos, tipos de caso (FTTx y WAN) y usuarios reales.
- Opcional: `node scripts/simular-tickets.js` para no arrancar vacío.

### F4 · Despliegue
- Servidor, variables, HTTPS, reinicio automático (PM2 o el del hosting).
- Verificar el cierre de jornada 00:05 en hora de Caracas.

### F5 · Correo real (ver evaluación abajo)

### F6 · Piloto (1–2 semanas)
- Lista de revisión por rol (operador, coordinador, jefe, gerente): tomar, resolver, cerrar, guardia, reportes, Excel, correo.
- Fallos a `docs/pendientes.md`.

### F7 · Cierre del piloto
- Respaldo de la base, guía de despliegue, decisión de pasar a producción.
- Después: rediseño del login (Tailwind CDN) y "Tiempo en horario" con horario por operador.

## Evaluación: correo real sin TI

### Qué ya existe
- Modo **delegado** (`GRAPH_MODO="delegado"`, `npm run correo:login`): inicias sesión una vez con el buzón y el portal lo lee cada 30 s. No necesita secreto ni consentimiento de administrador y acepta cuentas personales (@outlook.com / @hotmail.com).
- `GRAPH_SOLO_LECTURA="si"`: solo lee; no marca leídos ni envía.
- Hilos: un correo con `INC-xxx` en el asunto se suma a la conversación de ese ticket.

### Qué falta: varios buzones, cada uno con su destino
Piloto: **FTTx → subgrupo Soporte**. Se manejarán **varios buzones** (uno por área/subgrupo). Hoy el código asume un solo buzón (`GRAPH_NOC_MAILBOX`, una sesión `.graph-sesion.json`, un estado `.graph-estado.json`) y todo entra a `GENERAL`.

Diseño propuesto:
- **Tabla `Buzon`** (migración Prisma): `correo` (único), `area_codigo`, `subgrupo_id?`, `activo`, `solo_lectura`, `ultima_revision`, `ultimo_error`. Se configura en **Administración → Buzones** (como Áreas: se desactiva, no se borra). Sin buzones en la tabla se usa `GRAPH_NOC_MAILBOX` → `GENERAL` (compatibilidad).
- **`Ticket.buzon_id`** (opcional): de qué buzón llegó. La respuesta desde el portal sale **desde ese mismo buzón**.
- **Ingesta**: cada vuelta recorre los buzones activos uno tras otro; un buzón con error no detiene a los demás (queda `ultimo_error` visible en Administración).
- **Ticket nuevo**: `area_designada` y `subgrupo_id` del buzón. Si el subgrupo luego se desactiva, cae al área sin subgrupo.
- **Duplicados**: un mismo correo enviado a dos buzones (copia) crearía dos tickets → guardar `internetMessageId` del correo y no repetir.
- **Sesiones**:
  - Modo aplicación (producción, TI): una sola credencial lee todos los buzones (`/users/{correo}`); TI restringe la app a esos buzones.
  - Modo delegado (prueba, sin TI): **una sesión por buzón**: `npm run correo:login -- --buzon=soporte...@outlook.com` guarda `.graph-sesiones/<correo>.json`. Estado de solo lectura también por buzón.
- Una forma de generar **varios correos** a la vez sin depender de personas (script de ráfaga).

### Opciones
| Opción | Qué prueba | Necesita | Costo |
|---|---|---|---|
| **A. Buzón Outlook.com propio + modo delegado** (recomendada) | El flujo real de Graph: llegada, hilos INC-xxx, respuestas, avisos | Crear una cuenta Outlook.com de prueba y registrar la app en Azure con una cuenta personal (Microsoft puede pedir activar una cuenta gratis de Azure para tener directorio) | Gratis; poco código (área destino + script de ráfaga) |
| B. Inyector sin correo | Pantallas y flujo de tickets con `origen_ingesta: 'CORREO'` | Nada | Mínimo; no prueba Graph |
| C. Gmail por IMAP/SMTP | Correo real, pero por otra vía | Contraseña de aplicación de Gmail; código nuevo (IMAP) que no se usará en producción | Más código desechable |

### Plan con la opción A
1. (Jacu) Crear 2 cuentas Outlook.com de prueba: una para **FTTx/Soporte** y otra para otra área (p. ej. WAN), para probar el reparto entre buzones.
2. (Jacu) Registrar **una** app `KIp-Portal-Prueba` según `docs/GRAPH_API_SETUP.md` (Escenario 2); sirve para todos los buzones.
3. ✅ (Claude, rama `feat/buzones`, 2026-10-23) Migración `20261023120000_buzones` (`Buzon`, `Ticket.buzon_id`, `correo_id` en `Ticket` y `Mensaje`); ingesta por buzón (uno con error no detiene a los demás); respuesta desde el buzón de origen; Administración → Buzones de correo (estado, última revisión, error, sesión); `correo:login -- --buzon=`. Pruebas: `test:buzones`.
4. (Jacu) `npx prisma migrate deploy`, `npx prisma generate`, dar de alta los buzones en Administración y `npm run correo:login -- --buzon=...` por cada uno.
5. (Claude, después; no es necesario para detectar correos) Script `node scripts/rafaga-correos.js --buzon=... --n=10`: envía N correos variados a ese buzón para ver cómo se refrescan las pantallas en vivo (`vivo.js`) al llegar varios.
6. Probar a mano: correos desde 2–3 cuentas distintas, uno en copia a los dos buzones (no debe duplicar), y respuestas a un `INC-xxx`.
7. En producción: modo aplicación con los buzones reales de TI; solo cambian las variables y las filas de `Buzon`.
