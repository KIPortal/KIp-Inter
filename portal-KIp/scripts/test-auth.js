// Pruebas de contraseñas cifradas, inicio de sesión y acceso de desarrollo. Sin base de datos.
const assert = require('assert');
const prisma = require('../src/config/prisma');
const { hashPassword, verifyPassword, isHashed } = require('../src/services/passwordService');
const { isDevLoginEnabled } = require('../src/config/devLogin');
const auth = require('../src/controllers/authController');
const ticketCtrl = require('../src/controllers/ticketController');

let total = 0, passed = 0;
async function t(name, fn) {
    total++;
    try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); }
    catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); }
}
const mockRes = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
const reqLogin = (email, clave) => ({ body: { email, clave }, session: {} });
const env = { ...process.env };
const restoreEnv = () => { process.env.NODE_ENV = env.NODE_ENV; process.env.ALLOW_DEV_LOGIN = env.ALLOW_DEV_LOGIN; if (env.NODE_ENV === undefined) delete process.env.NODE_ENV; if (env.ALLOW_DEV_LOGIN === undefined) delete process.env.ALLOW_DEV_LOGIN; };

(async () => {
    console.log('\n=== PRUEBAS: AUTENTICACIÓN Y CONTRASEÑAS ===\n');

    await t('Hash: no guarda texto plano, es distinto cada vez (sal) y verifica bien', () => {
        const a = hashPassword('secreta'), b = hashPassword('secreta');
        assert(isHashed(a) && !a.includes('secreta'));
        assert.notStrictEqual(a, b);
        assert.strictEqual(verifyPassword('secreta', a).ok, true);
        assert.strictEqual(verifyPassword('otra', a).ok, false);
        assert.strictEqual(verifyPassword('secreta', a).needsRehash, false);
    });
    await t('Contraseña antigua en texto plano: se acepta y pide convertirla a hash', () => {
        assert.deepStrictEqual(verifyPassword('op123', 'op123'), { ok: true, needsRehash: true });
        assert.deepStrictEqual(verifyPassword('mala', 'op123'), { ok: false, needsRehash: false });
    });
    await t('Entradas raras no rompen: vacío, null, hash corrupto', () => {
        assert.strictEqual(verifyPassword('x', '').ok, false);
        assert.strictEqual(verifyPassword(null, 'x').ok, false);
        assert.strictEqual(verifyPassword('x', 'scrypt$abc$$').ok, false);
        assert.strictEqual(verifyPassword('x', 'scrypt$16384$@@@$@@@').ok, false);
    });
    await t('Login con hash: entra y no reescribe la clave', async () => {
        let updated = false;
        prisma.user.findUnique = async () => ({ id: 'u1', email: 'a@x.com', nombre: 'A', rol: 'OPERADOR', area_designada: 'WAN', clave: hashPassword('buena') });
        prisma.user.update = async () => { updated = true; };
        const req = reqLogin('a@x.com', 'buena'); const res = mockRes();
        await auth.login(req, res);
        assert.strictEqual(res.body.success, true);
        assert.strictEqual(req.session.userId, 'u1');
        assert.strictEqual(updated, false);
    });
    await t('Login con clave antigua en texto plano: entra y la guarda cifrada', async () => {
        let saved = null;
        prisma.user.findUnique = async () => ({ id: 'u2', email: 'b@x.com', nombre: 'B', rol: 'COORDINADOR', area_designada: 'WAN', clave: 'admin123' });
        prisma.user.update = async ({ data }) => { saved = data.clave; };
        const res = mockRes();
        await auth.login(reqLogin('b@x.com', 'admin123'), res);
        assert.strictEqual(res.body.success, true);
        assert(isHashed(saved) && verifyPassword('admin123', saved).ok);
    });
    await t('Login: contraseña incorrecta o usuario inexistente da 401 igual y no crea sesión', async () => {
        restoreEnv();
        prisma.user.findUnique = async () => ({ id: 'u1', email: 'a@x.com', clave: hashPassword('buena') });
        const req = reqLogin('a@x.com', 'mala'); const res = mockRes();
        await auth.login(req, res);
        assert.strictEqual(res.code, 401);
        assert.strictEqual(req.session.userId, undefined);
        prisma.user.findUnique = async () => null;
        const res2 = mockRes(); const req2 = reqLogin('nadie@x.com', 'x');
        await auth.login(req2, res2);
        assert.strictEqual(res2.code, 401);
        assert.strictEqual(res2.body.message, res.body.message);
        assert.strictEqual(req2.session.userId, undefined);
    });
    await t('Acceso de desarrollo: apagado por defecto, solo con ALLOW_DEV_LOGIN=true y fuera de producción', () => {
        delete process.env.NODE_ENV; delete process.env.ALLOW_DEV_LOGIN;
        assert.strictEqual(isDevLoginEnabled(), false, 'sin variable');
        process.env.ALLOW_DEV_LOGIN = 'true';
        assert.strictEqual(isDevLoginEnabled(), true);
        process.env.NODE_ENV = 'production';
        assert.strictEqual(isDevLoginEnabled(), false, 'nunca en producción');
        restoreEnv();
    });
    await t('Sin acceso de desarrollo, un correo inexistente NO entra como coordinador', async () => {
        delete process.env.NODE_ENV; delete process.env.ALLOW_DEV_LOGIN;
        prisma.user.findUnique = async () => null;
        const req = reqLogin('intruso@x.com', 'cualquiera'); const res = mockRes();
        await auth.login(req, res);
        assert.strictEqual(res.code, 401);
        assert.strictEqual(req.session.temporaryUser, undefined);
        restoreEnv();
    });
    await t('Login: no imprime la contraseña en consola', async () => {
        const logs = []; const orig = console.log; console.log = (...a) => logs.push(a.join(' '));
        prisma.user.findUnique = async () => null;
        await auth.login(reqLogin('a@x.com', 'ClaveSuperSecreta'), mockRes());
        console.log = orig;
        assert(!logs.some(l => l.includes('ClaveSuperSecreta')));
    });
    await t('Reasignar un ticket RESUELTO o CERRADO se rechaza (409)', async () => {
        prisma.user.findFirst = async () => ({ id: 'op' });
        for (const estado of ['RESUELTO', 'CERRADO']) {
            prisma.ticket.findUnique = async () => ({ id: 't', estado_actual: estado });
            const res = mockRes();
            await ticketCtrl.assignTicket({ body: { ticketCode: 'INC-1', operatorId: 'op' } }, res);
            assert.strictEqual(res.code, 409, estado);
        }
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
