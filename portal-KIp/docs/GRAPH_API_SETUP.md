# 📘 Guía de Configuración: Microsoft Graph API (Ingesta de Correos)

Esta guía detalla los pasos necesarios para conectar el **KPi-Portal** con Microsoft 365 para la lectura automatizada de correos y generación de tickets.

⚠️ **Limitación Importante:** Microsoft Graph API **no permite** el uso de cuentas personales (ej. `@hotmail.com`, `@outlook.com`) para procesos automáticos de servidor en segundo plano. Se requiere obligatoriamente una **cuenta corporativa o educativa** con licencia activa de Exchange Online.

---

## 🏗️ Escenario 1: Acceso de Administrador (Client Credentials Flow)
*Recomendado para entornos de producción. Requiere permisos de administrador global en el portal de Azure (Microsoft Entra ID).*

Este método permite que el servidor lea los correos de forma 100% invisible, sin interacción humana.

### Pasos de Configuración en Azure:
1. Ir a [portal.azure.com](https://portal.azure.com/) e ingresar a **Microsoft Entra ID**.
2. Navegar a **App registrations** (Registros de aplicaciones) > **New registration**.
3. Nombrar la aplicación (ej. `NOC-Portal-Ingestion`) y elegir **Accounts in this organizational directory only** (Single tenant).
4. Ir a **API permissions** > **Add a permission** > **Microsoft Graph** > **Application permissions** (NO delegados).
5. Buscar y marcar la casilla `Mail.Read`.
6. **[CRÍTICO]** Hacer clic en **Grant admin consent for [Tu Organización]** y confirmar.
7. Ir a **Certificates & secrets** > **New client secret**. Copiar el `Value` (Secreto).
8. Ir a **Overview**. Copiar el `Application (client) ID` y el `Directory (tenant) ID`.

### Configuración en `.env`:
```env
GRAPH_TENANT_ID="tu-tenant-id"
GRAPH_CLIENT_ID="tu-client-id"
GRAPH_CLIENT_SECRET="tu-secret-value"
GRAPH_NOC_MAILBOX="soporte@empresa.com"
GRAPH_TARGET_FOLDER="inbox"
```

---

## 👤 Escenario 2: Acceso de Usuario Estándar (Delegated Permissions)
*Recomendado cuando solo posees un correo corporativo prestado y su contraseña, sin acceso de administrador al tenant de Azure de dicha empresa.*

Este método requiere que un usuario inicie sesión manualmente una vez a través de un enlace para autorizar a la aplicación. El sistema guardará un "Refresh Token" para continuar leyendo en segundo plano.

### Pasos de Configuración:
1. El administrador de tu propio Azure (o tú mismo en una cuenta de desarrollador) debe crear una App Registration.
2. En **API permissions**, se debe agregar **Microsoft Graph** > **Delegated permissions** > `Mail.Read` y `offline_access`. *(En este caso, NO se requiere el botón de "Admin Consent").*
3. En **Authentication**, agregar una plataforma tipo **Mobile and desktop applications** o configurar una **Redirect URI** (`http://localhost:3000/auth/callback`).
4. Al arrancar el servidor, la terminal mostrará un enlace de inicio de sesión.
5. El operador abre el enlace, inicia sesión con la **cuenta corporativa prestada**, y acepta los permisos.

---

## 🛠️ Herramientas de Diagnóstico Incorporadas

El proyecto incluye scripts automatizados para verificar la salud de la integración sin comprometer el servidor principal.

### 1. Diagnóstico de Conexión
Verifica que las credenciales del `.env` sean válidas y diagnostica errores comunes (ej. `AADSTS700016`).
```bash
npm run diagnose:azure
```

### 2. Simulador de Ingesta (Modo Offline)
Si no dispones temporalmente de un buzón corporativo, puedes simular la llegada de correos para probar la lógica de creación de tickets y WebSockets.
```bash
npm run test:azure
```
