# 📘 Guía de Configuración: Microsoft Graph API (Ingesta de Correos)

Esta guía detalla los pasos necesarios para conectar el **KPi-Portal** con Microsoft 365 para la lectura automatizada de correos y generación de tickets.

⚠️ **Cuentas personales:** el Escenario 1 (secreto de la app, producción) necesita una cuenta corporativa con Exchange Online. El Escenario 2 (modo de prueba, delegado) **sí** funciona con cuentas personales (`@outlook.com`, `@hotmail.com`): sirve para probar sin TI.

## 📬 Varios buzones (Administración → Buzones de correo)
Cada buzón crea sus tickets en su área y, si se elige, su subgrupo (p. ej. `soporte@…` → FTTx · Soporte). La respuesta desde el portal sale por el buzón donde llegó el ticket. Un correo en copia a dos buzones crea un solo ticket.
- Mientras la lista esté vacía se usa `GRAPH_NOC_MAILBOX` (o la sesión de `graph-login.js` sin `--buzon`) y todo entra a General. Con un buzón en la lista, el del `.env` deja de leerse.
- **Escenario 1:** la misma app lee todos los buzones (`/users/<correo>`); pedir a TI que la restrinja a esos buzones.
- **Escenario 2:** una sola app registrada; **cada buzón inicia sesión una vez**:
  ```powershell
  npm run correo:login -- --buzon=soporte-prueba@outlook.com
  ```
  La sesión queda en `portal-KIp/.graph-sesiones/<correo>.json` (no se sube a git). Si se entra con otra cuenta, el script no la guarda. Para borrarla: agrega `--salir`. Para un buzón en solo lectura: `--solo-lectura`.
- En Administración se ve, por buzón, si falta iniciar sesión, la última revisión y el último error.

---

## 🏗️ Escenario 1: Acceso de Administrador (Client Credentials Flow)
*Recomendado para entornos de producción. Requiere permisos de administrador global en el portal de Azure (Microsoft Entra ID).*

Este método permite que el servidor lea los correos de forma 100% invisible, sin interacción humana.

### Pasos de Configuración en Azure:
1. Ir a [portal.azure.com](https://portal.azure.com/) e ingresar a **Microsoft Entra ID**.
2. Navegar a **App registrations** (Registros de aplicaciones) > **New registration**.
3. Nombrar la aplicación (ej. `NOC-Portal-Ingestion`) y elegir **Accounts in this organizational directory only** (Single tenant).
4. Ir a **API permissions** > **Add a permission** > **Microsoft Graph** > **Application permissions** (NO delegados).
5. Buscar y marcar `Mail.ReadWrite` y `Mail.Send` (este último para responder desde el portal). `Mail.ReadWrite` porque el servicio marca los correos como leídos con PATCH; con solo `Mail.Read` esa llamada falla con 403. **Pedir a TI que restrinja la app al buzón compartido del NOC** (Application Access Policy / RBAC for Applications); sin esa restricción el permiso de aplicación alcanza todos los buzones del tenant.
6. **[CRÍTICO]** Hacer clic en **Grant admin consent for [Tu Organización]** y confirmar.
7. Ir a **Certificates & secrets** > **New client secret**. Copiar el `Value` (Secreto).
8. Ir a **Overview**. Copiar el `Application (client) ID` y el `Directory (tenant) ID`.

### Configuración en `.env`:
```env
GRAPH_MODO="aplicacion"
GRAPH_TENANT_ID="tu-tenant-id"
GRAPH_CLIENT_ID="tu-client-id"
GRAPH_CLIENT_SECRET="tu-secret-value"
GRAPH_NOC_MAILBOX="soporte@empresa.com"
GRAPH_TARGET_FOLDER="inbox"
```

---

## 👤 Escenario 2: Modo de prueba con inicio de sesión (Delegated Permissions)
*Para probar sin que TI cree nada: tú registras la app en tu propia cuenta de Azure e inicias sesión una vez con el correo del buzón. El portal lee y responde desde ese buzón (`/me`).*

### Registrar la app (una vez, en portal.azure.com con tu cuenta)
1. **Microsoft Entra ID → App registrations → New registration.** Nombre: `KIp-Portal-Prueba`. Tipo de cuenta: **Accounts in any organizational directory and personal Microsoft accounts**. Sin Redirect URI.
2. **Authentication → Advanced settings → Allow public client flows = Yes** y guardar. (Sin esto el inicio de sesión con código da `AADSTS7000218`.)
3. **API permissions → Add a permission → Microsoft Graph → Delegated permissions:** `Mail.ReadWrite`, `Mail.Send` y `offline_access`. No hace falta "Grant admin consent" ni secreto.
4. **Overview:** copia el *Application (client) ID*.

### `.env`
```env
GRAPH_MODO="delegado"
GRAPH_CLIENT_ID="el-application-client-id"
GRAPH_TENANT_ID="common"
GRAPH_NOC_MAILBOX="buzon@empresa.com"   # solo para mostrarlo en el portal
```

### Iniciar sesión (una vez)
```powershell
cd portal-KIp
npm run correo:login
```
Abre el enlace, escribe el código e inicia sesión con el correo del buzón. El script prueba la Bandeja de entrada y guarda la sesión en `portal-KIp/.graph-sesion.json` (no se sube a git; contiene el token de renovación, trátalo como una clave). Para cambiar de cuenta: `node scripts/graph-login.js --salir`.

**Si el correo es de una empresa** (no @outlook.com), la empresa debe permitir que los usuarios aprueben apps. Si al iniciar sesión sale "Se necesita la aprobación del administrador", este modo no sirve con ese correo hasta que un administrador apruebe la app.

---

## 👁️ Solo lectura (`GRAPH_SOLO_LECTURA="si"`)
Sirve con cualquiera de los dos escenarios. El portal solo **lee** la Bandeja de entrada y crea tickets:
- Basta el permiso `Mail.Read` (Application o Delegated, según el escenario). Con delegado, además `offline_access`.
- No marca correos como leídos ni envía respuestas: responder desde el portal guarda el mensaje sin enviarlo.
- Recuerda hasta qué correo leyó en `portal-KIp/.graph-estado.json` (no se sube a git). La primera vez empieza desde ese momento: los correos que ya estaban no se importan. Para volver a empezar desde ahora, borra ese archivo.

---

## 🛠️ Herramientas de Diagnóstico Incorporadas

El proyecto incluye scripts automatizados para verificar la salud de la integración sin comprometer el servidor principal.

### 1. Diagnóstico de Conexión
Verifica que las credenciales del `.env` sean válidas y diagnostica errores comunes (ej. `AADSTS700016`).
```bash
node scripts/diagnose-azure.js   # solo el modo con secreto
```

### 2. Pruebas sin buzón
```bash
npm run test:graph          # modos de autenticación (aplicación / delegado)
npm run test:conversacion   # cómo se guardan los correos en la conversación
```
