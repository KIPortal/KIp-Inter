# Pendientes y decisiones aplazadas

## Seguridad del login (aplazado a propósito)

Todo el trabajo está hecho y probado en la rama **`feat/seguridad-login`** (commit `5279b3c`). No está en `main` ni en `feat/metricas-fase-a`. Para retomarlo: `git merge feat/seguridad-login` y correr `npm run test:auth`.

Qué incluye:
1. **Se deja de imprimir la contraseña en consola.** Hoy `authController.login` hace `console.log("=== LOGIN ATTEMPT ===", req.body)`, que escribe el correo y la clave en texto claro en los registros del servidor.
2. **Contraseñas cifradas (scrypt).** Las claves antiguas en texto plano siguen funcionando y se convierten a hash en el siguiente inicio de sesión correcto.
3. **Acceso de desarrollo apagado por defecto.** Hoy, si `NODE_ENV` no es `production`, cualquier correo sin usuario entra como coordinador. La rama lo deja detrás de `ALLOW_DEV_LOGIN=true` (nunca en producción).
4. `.env.example` documenta `SESSION_SECRET` y `ALLOW_DEV_LOGIN`.

Riesgo mientras no se fusione: si el servidor se despliega sin `NODE_ENV=production`, el punto 3 permite entrar sin credenciales. Antes de dar acceso a otras personas, **define `NODE_ENV=production` y `SESSION_SECRET`** o fusiona la rama.

También quedan sin hacer: límite de intentos de login y cambiar las contraseñas de prueba.

## Otros pendientes

- Teléfono de guardia de Telefonía: decidir si se guarda en el sistema o solo se contacta por correo (§12 de la especificación).
- Campos de red (Permisor, Serial PON, Nodo OLT, MAC, abonado) del reporte antiguo: se podrían extraer del texto del correo si el formato es estable.
- Indicador "cumplimiento de tiempo objetivo" del reporte antiguo: no se incluye (parecido a un SLA); requeriría definir tiempos objetivo.
