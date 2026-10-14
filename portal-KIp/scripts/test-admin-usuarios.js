// Pruebas de alta y edición de usuarios en Administración. Sin base de datos.
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const prisma = require('../src/config/prisma');
const { validateUser, describeUser } = require('../src/services/userAdminService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }
const res = () => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };

(async () => {
    console.log('\n=== PRUEBAS: ADMINISTRACIÓN DE USUARIOS ===\n');

    await t('Validación al crear: nombre, correo, rol, área y clave temporal', () => {
        assert.deepStrictEqual(validateUser({ nombre: '  Ana   Pérez ', email: ' ANA@Inter.com ', rol: 'OPERADOR', area: 'WAN', clave: 'abcd1234' }, { nuevo: true }), {
            datos: { nombre: 'Ana Pérez', email: 'ana@inter.com', rol: 'OPERADOR', area_designada: 'WAN', clave: 'abcd1234' }
        });
        assert.ok(validateUser({ nombre: 'Al', email: 'a@b.co', clave: 'abcd1234' }, { nuevo: true }).error.includes('nombre'));
        assert.ok(validateUser({ nombre: 'Ana', email: 'no-es-correo', clave: 'abcd1234' }, { nuevo: true }).error.includes('correo'));
        assert.ok(validateUser({ nombre: 'Ana', email: 'a@b.co', clave: 'corta' }, { nuevo: true }).error.includes('clave'));
        assert.ok(validateUser({ nombre: 'Ana', email: 'a@b.co', clave: 'abcd1234', rol: 'ADMIN' }, { nuevo: true }).error.includes('Rol'));
        assert.ok(validateUser({ nombre: 'Ana', email: 'a@b.co', clave: 'abcd1234', area: 'MARTE' }, { nuevo: true }).error.includes('Área'));
        assert.strictEqual(validateUser({ nombre: 'Ana', email: 'a@b.co', clave: 'abcd1234' }, { nuevo: true }).datos.area_designada, 'GENERAL');
    });

    await t('Validación al editar: solo lo enviado; clave vacía no cambia', () => {
        assert.deepStrictEqual(validateUser({ area: 'TELEFONIA', clave: '' }), { datos: { area_designada: 'TELEFONIA' } });
        assert.ok(validateUser({}).error.includes('No hay cambios'));
    });

    await t('Auditoría sin la clave', () => {
        const antes = { nombre: 'Ana Pérez', email: 'ana@x.com', rol: 'OPERADOR', area_designada: 'WAN' };
        const txt = describeUser(antes, { area_designada: 'TELEFONIA', clave: 'secreta123' });
        assert.strictEqual(txt, 'Ana Pérez: área: WAN → Telefonía, clave temporal cambiada');
        assert.ok(!txt.includes('secreta123'));
        assert.strictEqual(describeUser(null, { nombre: 'Ana', email: 'a@x.com', rol: 'OPERADOR', area_designada: 'WAN', clave: 'secreta123' }), 'Ana (a@x.com) · operador · WAN');
    });

    const ctrl = require('../src/controllers/adminController');
    const logs = [];
    prisma.auditLog = { create: async ({ data }) => { logs.push(data); } };

    await t('Crear: guarda, audita y no devuelve la clave; correo repetido 409', async () => {
        let creado;
        prisma.user.findUnique = async () => null;
        prisma.user.create = async ({ data }) => { creado = data; return { id: 'n1', ...data }; };
        const r = res();
        await ctrl.createUser({ body: { nombre: 'Ana Pérez', email: 'ana@x.com', rol: 'OPERADOR', area: 'WAN', clave: 'abcd1234' }, user: { id: 'c1', rol: 'COORDINADOR' } }, r);
        assert.strictEqual(r.code, 201);
        assert.strictEqual(creado.clave, 'abcd1234');
        assert.ok(!('clave' in r.body.usuario));
        assert.strictEqual(logs.pop().accion, 'USUARIO_CREADO');
        prisma.user.findUnique = async () => ({ id: 'otro' });
        const r2 = res();
        await ctrl.createUser({ body: { nombre: 'Ana Pérez', email: 'ana@x.com', clave: 'abcd1234' }, user: { id: 'c1', rol: 'COORDINADOR' } }, r2);
        assert.strictEqual(r2.code, 409);
    });

    await t('Editar: no cambia su propio rol; operador con activos no pasa a coordinador', async () => {
        prisma.user.findUnique = async ({ where }) => (where.id ? { id: where.id, nombre: 'Ana', email: 'ana@x.com', rol: where.id === 'c1' ? 'COORDINADOR' : 'OPERADOR', area_designada: 'WAN' } : null);
        const r = res();
        await ctrl.updateUser({ params: { id: 'c1' }, body: { rol: 'OPERADOR' }, user: { id: 'c1', rol: 'COORDINADOR' } }, r);
        assert.strictEqual(r.code, 409);
        prisma.ticket.count = async () => 2;
        const r2 = res();
        await ctrl.updateUser({ params: { id: 'o1' }, body: { rol: 'COORDINADOR' }, user: { id: 'c1', rol: 'COORDINADOR' } }, r2);
        assert.strictEqual(r2.code, 409);
        assert.ok(r2.body.error.includes('2 tickets activos'));
    });

    await t('Editar: cambia el área y audita', async () => {
        let data;
        prisma.user.update = async args => { data = args.data; return { id: 'o1', nombre: 'Ana', email: 'ana@x.com', rol: 'OPERADOR', area_designada: 'TELEFONIA' }; };
        const r = res();
        await ctrl.updateUser({ params: { id: 'o1' }, body: { area: 'TELEFONIA' }, user: { id: 'c1', rol: 'COORDINADOR' } }, r);
        assert.strictEqual(r.code, 200);
        assert.deepStrictEqual(data, { area_designada: 'TELEFONIA' });
        assert.strictEqual(logs.pop().detalles, 'Ana: área: WAN → Telefonía');
    });

    await t('Vista: botones de agregar y editar, y grupo Coordinadores', async () => {
        const { mergeConfig, EVENTOS, DESTINATARIOS } = require('../src/services/configService');
        const html = await ejs.renderFile(path.join(__dirname, '..', 'views', 'admin.ejs'), {
            currentUser: { nombre: 'Coord', rol: 'COORDINADOR' }, config: mergeConfig(),
            areas: [{ codigo: 'WAN', nombre: 'WAN', operadores: [{ id: 'o1', area: 'WAN', nombre: 'Ana Pérez', email: 'a@x', estado: { etiqueta: 'En turno', grupo: 'turno' }, carga: 1 }], turno: 1, guardia: 0 }],
            coordinadores: [{ id: 'c1', nombre: 'Coord', email: 'c@x' }], miId: 'c1', minClave: 8,
            eventos: EVENTOS, destinatarios: DESTINATARIOS, limites: { plantillas: 12, texto: 120 },
            vistaPrevia: { sobrecarga: [], antiguedad: [] }, activos: 1, enTurno: 1, totalOperadores: 1
        });
        assert.ok(html.includes('data-user-new="WAN"') && html.includes('data-user-edit="o1"'));
        assert.ok(html.includes('data-area-pick="__coord"') && html.includes('Coord (tú)'));
        assert.ok(html.includes('"usuarios":[{"id":"o1"'));
    });

    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
