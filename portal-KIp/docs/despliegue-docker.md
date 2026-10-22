# Desplegar el portal con Docker

La imagen (`portal-KIp/Dockerfile`) es la misma para el ambiente de pruebas y para el servidor de Inter. La base sigue en Supabase: el contenedor solo necesita las variables del `.env`.

## Qué necesita el contenedor
- **Proceso siempre encendido**: cierre de jornada a las 00:05 (Caracas), lectura de correo cada `GRAPH_INTERVALO_SEGUNDOS` y actualizaciones en vivo. Por eso no sirven Workers, Vercel ni planes gratis que "se duermen" (Render, Koyeb).
- **Un volumen en `/datos`**: fotos de perfil, Excel de jornadas y la sesión de correo de Graph. Sin volumen se pierden en cada redespliegue.

## Variables
Las de tu `.env` (`DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET`, las `GRAPH_*`) más:

| Variable | Valor | Para qué |
|---|---|---|
| `TRUST_PROXY` | `1` | Detrás de un proxy https (Caddy, cloudflared hacia el contenedor), para que el login funcione. `docker-compose.yml` ya lo pone. Solo con `npm start` + cloudflared sin Docker no hace falta. |
| `GRAPH_WEBHOOK_URL` | `https://<tu-dominio>/api/graph/notificaciones` | Opcional: aviso instantáneo de correo. Sin él, el buzón se revisa cada 30 s. |

`NODE_ENV=production`, `PORT=3000` y las rutas de `/datos` ya vienen en la imagen. En producción solo entra quien tenga clave. Las migraciones las sigues aplicando tú con `npx prisma migrate deploy` antes de desplegar.

## Opción A: VM gratis de Oracle Cloud (24/7)
Archivos: `docker-compose.yml` (portal + Caddy) y `despliegue/Caddyfile`. Caddy saca solo el certificado https.

1. **Cuenta**: regístrate en https://www.oracle.com/cloud/free/ (pide tarjeta solo para verificar). Elige como región de origen una cercana (p. ej. *US East (Ashburn)*); no se puede cambiar después.
2. **VM**: *Compute → Instances → Create instance*.
   - Imagen: *Ubuntu 24.04*. Forma: *VM.Standard.A1.Flex* (Ampere, 1 OCPU y 6 GB bastan) o *VM.Standard.E2.1.Micro* si no hay capacidad de A1. Ambas son "Always Free".
   - Descarga la clave SSH que te ofrece (`.key`).
3. **Puertos**: en la *Virtual Cloud Network* de la VM → *Security Lists → Default* → *Add Ingress Rules*: origen `0.0.0.0/0`, TCP, puertos `80` y `443`.
4. **Dominio gratis**: entra a https://www.duckdns.org con tu cuenta, crea un subdominio (p. ej. `kip-pruebas`) y pon la IP pública de la VM.
5. **Entrar a la VM** desde PowerShell:
   ```powershell
   ssh -i C:\ruta\a\tu-clave.key ubuntu@IP_PUBLICA
   ```
6. **En la VM** (Linux, no PowerShell):
   ```bash
   # Docker
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker ubuntu && newgrp docker
   # Firewall interno de la imagen de Oracle: abrir 80 y 443
   sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   # Código
   git clone https://github.com/KIPortal/KIp-Inter.git && cd KIp-Inter/portal-KIp
   nano .env                                   # pega tu .env (cambia SESSION_SECRET por uno largo)
   cp despliegue/caddy.env.example despliegue/caddy.env
   nano despliegue/caddy.env                   # DOMINIO=tu-subdominio.duckdns.org
   docker compose up -d --build
   docker compose logs -f portal               # espera "Servidor NOC activo"
   ```
   Si el repo es privado, `git clone` te pide usuario y un *personal access token* de GitHub (solo lectura).
7. Abre `https://tu-subdominio.duckdns.org` e inicia sesión.
8. **Correo en modo delegado** (una sola vez; la sesión queda en el volumen):
   ```bash
   docker compose exec portal node scripts/graph-login.js
   ```
   Muestra un código que abres en cualquier navegador.

**Actualizar** tras fusionar cambios: `git pull && docker compose up -d --build`.

## Opción B: tu PC + túnel rápido de Cloudflare
Solo funciona mientras tu PC esté prendida, y el enlace cambia cada vez que arrancas el túnel. Necesitas Docker Desktop y cloudflared (ver la guía de la demo).

```powershell
cd portal-KIp
docker build -t portal-kip .
docker run -d --name portal-kip --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file .env -e TRUST_PROXY=1 -v portal-kip-datos:/datos portal-kip
cloudflared tunnel --url http://localhost:3000
```
Usa el enlace `https://...trycloudflare.com` que imprime cloudflared. Correo delegado: `docker exec -it portal-kip node scripts/graph-login.js`.

## Servidor de Inter
Igual que la opción A desde el paso 6 (Docker, `.env`, `docker compose up -d --build`). Si TI pone su propio proxy https, quita el servicio `caddy` de `docker-compose.yml` y publica el puerto 3000 del portal.
