# 🧪 Guía de Implementación: Prueba con Correo Corporativo (Usuario y Clave)

Esta guía detalla cómo modificar temporalmente el portal para conectarse a Microsoft Graph usando **Permisos Delegados** (Delegated Auth). 

Este método es ideal para la fase de pruebas cuando te prestan un correo corporativo (ej. `operador@empresa.com`) y su contraseña, pero **no tienes permisos de Administrador en el Azure de esa empresa** para dar "Admin Consent".

---

## Fase 1: Configuración en el Portal de Azure de la Empresa

Quien te preste la cuenta (o tú, si tienes acceso al portal) debe registrar una aplicación básica:

1. Entrar a **Microsoft Entra ID** > **App registrations** > **New registration**.
2. Nombrarla (ej. `KPi-Portal-Test`).
3. En **Authentication**, agregar una plataforma. Si probaremos en local, elige **Mobile and desktop applications** y marca la casilla que dice `https://login.microsoftonline.com/common/oauth2/nativeclient`.
   - *Asegúrate de habilitar "Allow public client flows" en la parte inferior de la pestaña Authentication.*
4. En **API permissions**, agregar permisos **Delegados** (NO Application):
   - `Mail.Read`
   - `User.Read`
   - `offline_access` (Crítico para que el servidor siga leyendo sin pedir clave cada 2 minutos).
5. Copiar el **Client ID** y el **Tenant ID**. (No se necesita Client Secret estricto para flujos públicos, pero si se usa Web Auth, sí).

---

## Fase 2: Lógica de Implementación en Node.js (El Código)

Para que tu servidor (que revisa el correo cada 2 minutos) pueda entrar a la cuenta sin pedirte la contraseña constantemente, usaremos el **Flujo de Código de Dispositivo (Device Code Flow)** o un **Refresh Token**.

### 1. Modificar la inicialización de MSAL
En tu archivo de conexión a Microsoft (ej. `emailIngestionService.js`), cambiaremos `ClientSecretCredential` por un flujo interactivo. 

```javascript
const { PublicClientApplication } = require('@azure/msal-node');
const fs = require('fs');

const msalConfig = {
    auth: {
        clientId: process.env.GRAPH_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}`
    }
};

const pca = new PublicClientApplication(msalConfig);
const TOKEN_CACHE_PATH = './token_cache.json';

// Función para obtener el token
async function obtenerTokenDelegado() {
    // 1. Intentar leer un token guardado previamente
    if (fs.existsSync(TOKEN_CACHE_PATH)) {
        const cache = JSON.parse(fs.readFileSync(TOKEN_CACHE_PATH));
        // Aquí se usaría la lógica para refrescar el token silenciosamente
        // pca.acquireTokenSilent(...)
    }

    // 2. Si no hay token, iniciar Device Code Flow (Solo se hace la primera vez)
    const deviceCodeRequest = {
        scopes: ["Mail.Read", "offline_access"],
        deviceCodeCallback: (response) => {
            console.log("================================================");
            console.log("🔐 ACCIÓN REQUERIDA PARA VINCULAR CORREO:");
            console.log(response.message); // Ej: "Entra a microsoft.com/devicelogin y escribe el código XYZ"
            console.log("================================================");
        }
    };

    const authResult = await pca.acquireTokenByDeviceCode(deviceCodeRequest);
    
    // 3. Guardar en caché para futuras consultas automáticas del servidor
    fs.writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(authResult));
    return authResult.accessToken;
}
```

### 2. ¿Cómo funciona en la práctica?
1. Cuando inicies tu servidor (`npm start`), la consola se pausará y te dirá: *"Por favor, entra a https://microsoft.com/devicelogin y pon el código **ABC-123***".
2. Vas a esa página, inicias sesión con el correo prestado y pones la clave.
3. Le das a "Aceptar permisos".
4. ¡Listo! La terminal de tu servidor recibe un `Access Token` y un `Refresh Token`.
5. El servidor guarda esto en un archivo local (`token_cache.json`).
6. A partir de ese momento, el cron job de tu servidor leerá los correos cada 2 minutos usando ese archivo, sin volver a pedirte la clave, tal cual lo haría en producción.

---

## Fase 3: Migración a Producción (El Futuro)

Una vez que pulas el programa y demuestres que el NOC Portal procesa perfectamente los tickets:

1. **La Empresa te da luz verde:** Te crearán el buzón definitivo (ej. `noc@empresa-grande.com`).
2. **Volvemos al plan original:** Le pedimos al administrador de IT de esa empresa que nos dé el **Admin Consent** (Permisos de Aplicación de servidor a servidor).
3. **Borramos el código de prueba:** Eliminamos el archivo `token_cache.json` y el código de Device Flow, y volvemos a poner nuestro `ClientSecretCredential` original.
4. Ya no tendrás que hacer login manual nunca más. El servidor operará de forma 100% invisible y perpetua.

> **Tip para múltiples carpetas:** En producción, si el correo `noc@empresa-grande.com` tiene subcarpetas (ej. "Alertas_Fibra", "Alertas_Radio"), la API de Graph permite consultarlas agregando el ID de la carpeta en la ruta de la solicitud HTTP:
> `https://graph.microsoft.com/v1.0/users/noc@empresa.com/mailFolders/{folder_id}/messages`
