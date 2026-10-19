/**
 * scripts/graph-login.js
 *
 * Inicia sesión en Microsoft con un código para el modo de prueba (GRAPH_MODO="delegado").
 * Se hace una sola vez: la sesión queda guardada en .graph-sesion.json (no se sube a git)
 * y el portal la renueva solo. Al terminar, comprueba que puede leer la Bandeja de entrada.
 *
 *   node scripts/graph-login.js           inicia sesión (o muestra la sesión actual) y prueba el buzón
 *   node scripts/graph-login.js --salir   borra la sesión guardada
 */
const fs = require('fs');
const { Client } = require('@microsoft/microsoft-graph-client');
const { loadEnvVariables } = require('./diagnose-azure');
const graphAuth = require('../src/services/graphAuthService');

/** Explica en español los errores más comunes del inicio de sesión delegado. */
function explicarError(err) {
    const txt = `${err && err.errorCode || ''} ${err && err.message || err}`;
    if (/AADSTS7000218|public client/i.test(txt)) {
        return 'La app no permite este tipo de inicio de sesión. En Azure: la app → Authentication → "Allow public client flows" = Yes, y guarda.';
    }
    if (/AADSTS50020|AADSTS50194|does not exist in tenant/i.test(txt)) {
        return 'La cuenta no es del mismo directorio que la app. Registra la app como "Accounts in any organizational directory and personal Microsoft accounts" y deja GRAPH_TENANT_ID vacío o en "common".';
    }
    if (/AADSTS65001|AADSTS90094|consent|admin approval|aprobaci/i.test(txt)) {
        return 'La organización del correo no deja que los usuarios aprueben apps por su cuenta. Hace falta que un administrador de esa organización apruebe la app (no se puede saltar desde aquí).';
    }
    if (/AADSTS700016|invalid_grant|unauthorized_client/i.test(txt)) {
        return 'Microsoft no reconoce la app: revisa que GRAPH_CLIENT_ID sea el "Application (client) ID" (Overview) y que "Allow public client flows" esté en Yes.';
    }
    if (/expired_token|code_expired|AADSTS70020/i.test(txt)) {
        return 'El código venció antes de usarlo (dura unos 15 minutos). Vuelve a correr el script.';
    }
    if (/MailboxNotEnabledForRESTAPI|MailboxNotFound/i.test(txt)) {
        return 'La cuenta no tiene un buzón de Exchange Online/Outlook disponible.';
    }
    if (/ErrorAccessDenied|403/i.test(txt)) {
        return 'Inició sesión, pero sin permiso de correo. Revisa que la app tenga los permisos delegados Mail.ReadWrite, Mail.Send y offline_access.';
    }
    return null;
}

async function probarBuzon(pca) {
    const client = Client.init({
        authProvider: (done) => graphAuth.tokenDelegado(pca).then(t => done(null, t), e => done(e, null))
    });
    const inbox = await client.api('/me/mailFolders/inbox').select('totalItemCount,unreadItemCount').get();
    console.log(`📬 Bandeja de entrada: ${inbox.totalItemCount} correos, ${inbox.unreadItemCount} sin leer.`);
    console.log('   Ojo: al encender el portal, los no leídos se convierten en tickets y quedan marcados como leídos.');
}

async function main() {
    loadEnvVariables();
    const archivo = graphAuth.archivoSesion();

    if (process.argv.includes('--salir')) {
        if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
        console.log('Sesión de correo borrada.');
        return;
    }

    if (graphAuth.modo() !== 'delegado') {
        console.log('⚠️  GRAPH_MODO no es "delegado" en el .env: el portal seguirá usando el modo con secreto.');
        console.log('   Pon GRAPH_MODO="delegado" para que el portal use esta sesión.\n');
    }

    const pca = graphAuth.crearClientePublico();
    const cuentas = await pca.getTokenCache().getAllAccounts();
    if (cuentas.length) {
        console.log(`Ya hay una sesión guardada: ${cuentas[0].username}. (Para cambiarla: node scripts/graph-login.js --salir)`);
    } else {
        const r = await graphAuth.iniciarSesionConCodigo(pca, (d) => {
            if (!d || !d.userCode) return; // Microsoft no dio código: el error llega después
            console.log(`1. Abre ${d.verificationUri} en el navegador.`);
            console.log(`2. Escribe el código: ${d.userCode}`);
            console.log('3. Inicia sesión con el correo del buzón y acepta los permisos.');
            console.log('   (El código dura unos 15 minutos; esta ventana espera sola.)\n');
        });
        console.log(`\n✅ Sesión iniciada como ${r.account && r.account.username}. Guardada en ${archivo}`);
    }
    await probarBuzon(pca);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('\n❌ No se pudo:', err && err.message || err);
        const ayuda = explicarError(err);
        if (ayuda) console.error('💡', ayuda);
        process.exitCode = 1;
    });
}

module.exports = { explicarError };
