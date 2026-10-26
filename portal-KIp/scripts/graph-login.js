/**
 * scripts/graph-login.js
 *
 * Inicia sesión en Microsoft con un código para el modo de prueba (GRAPH_MODO="delegado").
 * Se hace una sola vez: la sesión queda guardada en .graph-sesion.json (no se sube a git)
 * y el portal la renueva solo. Al terminar, comprueba que puede leer la Bandeja de entrada.
 *
 *   node scripts/graph-login.js           inicia sesión (o muestra la sesión actual) y prueba el buzón
 *   node scripts/graph-login.js --salir   borra la sesión guardada
 *
 * Con varios buzones (Administración → Buzones), una sesión por buzón en .graph-sesiones/:
 *   npm run correo:login -- --buzon=soporte@outlook.com           inicia sesión con ese buzón
 *   npm run correo:login -- --buzon=soporte@outlook.com --salir   borra su sesión
 *   --solo-lectura   pide solo Mail.Read (para un buzón en solo lectura)
 */
const fs = require('fs');
const { Client } = require('@microsoft/microsoft-graph-client');
const { loadEnvVariables } = require('./diagnose-azure');
const graphAuth = require('../src/services/graphAuthService');
const { normalizarCorreo } = require('../src/services/buzonService');

/** Explica en español los errores más comunes del inicio de sesión delegado. */
function explicarError(err) {
    const txt = `${err && err.errorCode || ''} ${err && err.message || err}`;
    if (/AADSTS7000218|public client/i.test(txt)) {
        return 'La app no permite este tipo de inicio de sesión. En Azure: la app → Authentication → "Allow public client flows" = Yes, y guarda.';
    }
    if (/AADSTS50020|AADSTS50194|does not exist in tenant/i.test(txt)) {
        return 'La cuenta no es del mismo directorio que la app. Registra la app como "Accounts in any organizational directory and personal Microsoft accounts" y deja GRAPH_TENANT_ID vacío o en "common".';
    }
    if (/SIN_PERMISOS|no tiene los permisos/i.test(txt)) {
        return 'Borra la sesión con --salir, vuelve a correr el script y acepta todos los permisos al iniciar sesión.';
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
        return graphAuth.soloLectura()
            ? 'Inició sesión, pero sin permiso de correo. Revisa que la app tenga los permisos delegados Mail.Read y offline_access.'
            : 'Inició sesión, pero sin permiso de correo. Revisa que la app tenga los permisos delegados Mail.ReadWrite, Mail.Send y offline_access.';
    }
    return null;
}

/** Opciones de la línea de comandos: { buzon, salir, soloLectura }. `buzon` es null si no se dio o no es un correo. */
function opciones(argv = process.argv) {
    const arg = argv.find(a => a.startsWith('--buzon='));
    return {
        buzon: arg ? normalizarCorreo(arg.slice('--buzon='.length)) : null,
        buzonDado: Boolean(arg),
        salir: argv.includes('--salir'),
        soloLectura: argv.includes('--solo-lectura')
    };
}

/** ¿La cuenta con la que se inició sesión es la del buzón? (sin --buzon, cualquiera sirve) */
const esCuentaDelBuzon = (username, buzon) => !buzon || String(username || '').trim().toLowerCase() === buzon;

async function probarBuzon(pca, scopes, soloLectura) {
    const client = Client.init({
        authProvider: (done) => graphAuth.tokenDelegado(pca, scopes).then(t => done(null, t), e => done(e, null))
    });
    const inbox = await client.api('/me/mailFolders/inbox').select('totalItemCount,unreadItemCount').get();
    console.log(`📬 Bandeja de entrada: ${inbox.totalItemCount} correos, ${inbox.unreadItemCount} sin leer.`);
    if (soloLectura) {
        console.log('   Solo lectura: el portal no marca ni envía nada; toma los correos que lleguen desde que se enciende.');
    } else {
        console.log('   Ojo: al encender el portal, los no leídos se convierten en tickets y quedan marcados como leídos.');
    }
}

async function main() {
    loadEnvVariables();
    const op = opciones();
    if (op.buzonDado && !op.buzon) throw new Error('El correo de --buzon= no es válido. Ej.: --buzon=soporte@outlook.com');
    // Con --buzon: la sesión de esa cuenta (o la general si ya es de esa cuenta: no hay que volver a entrar)
    const archivo = op.buzon
        ? graphAuth.sesionDeCuenta(op.buzon) || graphAuth.archivoSesionBuzon(op.buzon)
        : graphAuth.archivoSesion();
    const salir = op.buzon ? `npm run correo:login -- --buzon=${op.buzon} --salir` : 'node scripts/graph-login.js --salir';

    if (op.salir) {
        if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
        console.log(`Sesión de correo${op.buzon ? ` de ${op.buzon}` : ''} borrada.`);
        return;
    }

    if (graphAuth.modo() !== 'delegado') {
        console.log('⚠️  GRAPH_MODO no es "delegado" en el .env: el portal seguirá usando el modo con secreto.');
        console.log('   Pon GRAPH_MODO="delegado" para que el portal use esta sesión.\n');
    }

    const soloLectura = graphAuth.soloLectura() || op.soloLectura;
    const scopes = graphAuth.scopesDelegados(process.env, { soloLectura });
    const pca = graphAuth.crearClientePublico(process.env, archivo);
    const cuentas = await pca.getTokenCache().getAllAccounts();
    if (cuentas.length) {
        console.log(`Ya hay una sesión guardada: ${cuentas[0].username}. (Para cambiarla: ${salir})`);
    } else {
        const r = await graphAuth.iniciarSesionConCodigo(pca, (d) => {
            if (!d || !d.userCode) return; // Microsoft no dio código: el error llega después
            console.log(`1. Abre ${d.verificationUri} en el navegador.`);
            console.log(`2. Escribe el código: ${d.userCode}`);
            console.log(`3. Inicia sesión con ${op.buzon || 'el correo del buzón'} y acepta los permisos.`);
            console.log('   (El código dura unos 15 minutos; esta ventana espera sola.)\n');
        }, scopes);
        const usuario = r.account && r.account.username;
        if (!esCuentaDelBuzon(usuario, op.buzon)) {
            // Con otra cuenta el portal leería el buzón equivocado: no se guarda
            if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
            throw new Error(`Iniciaste sesión como ${usuario}, pero el buzón es ${op.buzon}. Vuelve a correr el script y entra con ${op.buzon} (si es un alias, usa en Administración el correo principal de la cuenta).`);
        }
        console.log(`\n✅ Sesión iniciada como ${usuario}. Guardada en ${archivo}`);
    }
    await probarBuzon(pca, scopes, soloLectura);
}

if (require.main === module) {
    main().catch((err) => {
        console.error('\n❌ No se pudo:', err && err.message || err);
        const ayuda = explicarError(err);
        if (ayuda) console.error('💡', ayuda);
        process.exitCode = 1;
    });
}

module.exports = { explicarError, opciones, esCuentaDelBuzon };
