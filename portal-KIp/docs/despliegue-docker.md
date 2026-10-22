# Desplegar el portal con Docker

La imagen (`portal-KIp/Dockerfile`) es la misma para el ambiente de pruebas y para el servidor de la empresa. La base sigue en Supabase: el contenedor solo necesita las variables del `.env`.

## Qué necesita el contenedor
- **Proceso siempre encendido**: cierre de jornada a las 00:05 (Caracas), lectura de correo cada `GRAPH_INTERVALO_SEGUNDOS` y actualizaciones en vivo. Por eso no sirven Workers, Vercel ni planes que "se duermen".
- **Un volumen en `/datos`**: fotos de perfil, Excel de jornadas y la sesión de correo de Graph. Sin volumen se pierden en cada redespliegue.

## Variables
Copia las de tu `.env` (`DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, las `GRAPH_*`) y agrega:

| Variable | Valor | Para qué |
|---|---|---|
| `TRUST_PROXY` | `1` | Detrás del proxy https del hosting, para que el login funcione. En tu PC con cloudflared no hace falta. |
| `GRAPH_WEBHOOK_URL` | `https://<tu-url>/api/graph/notificaciones` | Opcional: aviso instantáneo de correo. |

`NODE_ENV=production`, `PORT=3000` y las rutas de `/datos` ya vienen en la imagen. En producción solo entra quien tenga clave.

## Probar la imagen en tu PC (PowerShell, con Docker Desktop)
```powershell
cd portal-KIp
docker build -t portal-kip .
docker run --rm -p 3000:3000 --env-file .env -e NODE_ENV=production -v portal-kip-datos:/datos portal-kip
```
Abre http://localhost:3000. Las migraciones las sigues aplicando tú con `npx prisma migrate deploy` antes de desplegar.

## Railway
1. Crea un proyecto → *Deploy from GitHub repo* → elige el repo y en *Settings → Root Directory* pon `portal-KIp`. Railway detecta el Dockerfile.
2. *Variables*: pega las del `.env` más `TRUST_PROXY=1`.
3. Clic derecho en el servicio → *Attach volume* con *mount path* `/datos`.
4. *Settings → Networking → Generate Domain*. Esa es la URL fija.
5. Correo en modo delegado: la sesión de Graph se guarda en el volumen (`/datos/.graph-sesion.json`). Créala una vez desde una consola del contenedor (`railway ssh`) con `node scripts/graph-login.js`: muestra un código que abres en cualquier navegador.

## Servidor de la empresa
Mismos pasos que "Probar la imagen en tu PC", con `--restart unless-stopped` en vez de `--rm` y un proxy https delante (TI define cuál), con `TRUST_PROXY=1`.
