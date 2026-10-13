// Pruebas de áreas como tabla y usuarios activables. Sin base de datos.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/prisma');
const cat = require('../src/services/areaCatalog');
const { AREA_NAMES: NOMBRES_REPORTE, AREAS: AREAS_REPORTE } = require('../src/services/periodReportService');
const { validateUser } = require('../src/services/userAdminService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }
const res = () => { const r = { code: 200 }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; r.redirect = (a, b) => { r.redir = b || a; }; return r; };
const ORIGINAL = cat.allAreas();

(async () => {
    console.log('\n=== PRUEBAS: ÁREAS COMO TABLA Y USUARIOS ACTIVABLES ===\n');

    await t('Migración: convierte el tipo sin borrar columnas y siembra las 7 áreas', () => {
        const dir = path.join(__dirname, '..', 'prisma', 'migrations');
        const sql = fs.readFileSync(path.join(dir, fs.readdirSync(dir).find(d => d.endsWith('_areas_tabla')), 'migration.sql'), 'utf8');
        assert.ok(!/DROP COLUMN/i.test(sql), 'no debe borrar columnas (perdería datos)');
        assert.strictEqual((sql.match(/USING "area_designada"::text/g) || []).length, 2);
        cat.DEFAULT_AREAS.forEach(([codigo]) => assert.ok(sql.includes(`('${codigo}'`), codigo));
        assert.ok(/ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true/.test(sql));
        assert.ok(/DROP TYPE "AreaDesignada"/.test(sql));
    });

    await t('Catálogo: arranca con las 7 áreas y los servicios ven el mismo objeto vivo', () => {
        assert.strictEqual(cat.AREAS.length, 7);
        assert.strictEqual(NOMBRES_REPORTE, cat.AREA_NAMES);
        assert.strictEqual(AREAS_REPORTE, cat.AREAS);
    });

    await t('Recargar: nuevas áreas, desactivadas fuera de los selectores pero con nombre', async () => {
        prisma.area = { findMany: async () => [...ORIGINAL, { codigo: 'CENTRO_DATOS', nombre: 'Centro de Datos', activa: true }, { codigo: 'VIEJA', nombre: 'Área vieja', activa: false }] };
        await cat.refreshAreas(prisma, { force: true });
        assert.strictEqual(NOMBRES_REPORTE.CENTRO_DATOS, 'Centro de Datos');
        assert.ok(AREAS_REPORTE.includes('VIEJA'), 'el historial la conserva');
        assert.ok(!cat.activeAreas().some(a => a.codigo === 'VIEJA'));
        assert.strictEqual(cat.isActiveArea('VIEJA'), false);
        assert.ok(validateUser({ area: 'VIEJA' }).error.includes('desactivada'));
        assert.deepStrictEqual(validateUser({ area: 'CENTRO_DATOS' }).datos, { area_designada: 'CENTRO_DATOS' });
    });

    await t('Recargar: si la tabla no existe, conserva el catálogo', async () => {
        prisma.area = { findMany: async () => { throw new Error('relation "Area" does not exist'); } };
        await cat.refreshAreas(prisma, { force: true });
        assert.ok(cat.AREAS.includes('CENTRO_DATOS'));
    });

    await t('Nombres a código', () => {
        assert.strictEqual(cat.codeFromName('Telefonía IP'), 'TELEFONIA_IP');
        assert.deepStrictEqual(cat.validateAreaName('  Centro   de Datos '), { nombre: 'Centro de Datos', codigo: 'CENTRO_DE_DATOS' });
        assert.ok(cat.validateAreaName('x').error);
        assert.ok(cat.validateAreaName('¡¡!!').error);
    });

    const ctrl = require('../src/controllers/adminController');
    const logs = [];
    prisma.auditLog = { create: async ({ data }) => { logs.push(data); } };

    await t('Crear área: código desde el nombre, orden al final, nombre repetido 409', async () => {
        let creada;
        prisma.area = {
            findUnique: async () => null,
            findFirst: async () => ({ orden: 8 }),
            create: async ({ data }) => { creada = data; return data; },
            findMany: async () => [...ORIGINAL, { codigo: 'CENTRO_DE_DATOS', nombre: 'Centro de Datos', activa: true }]
        };
        const r = res();
        await ctrl.createArea({ body: { nombre: 'Centro de Datos' }, user: { id: 'c1' } }, r);
        assert.strictEqual(r.code, 201);
        assert.deepStrictEqual(creada, { codigo: 'CENTRO_DE_DATOS', nombre: 'Centro de Datos', orden: 9 });
        assert.strictEqual(logs.pop().accion, 'AREA_CREADA');
        assert.ok(cat.isActiveArea('CENTRO_DE_DATOS'), 'el catálogo se recarga al crear');
        prisma.area.findUnique = async () => ({ codigo: 'CENTRO_DE_DATOS' });
        const r2 = res();
        await ctrl.createArea({ body: { nombre: 'centro de datos' }, user: { id: 'c1' } }, r2);
        assert.strictEqual(r2.code, 409);
    });

    await t('Desactivar área: General nunca; con operadores o tickets activos no', async () => {
        prisma.area = { findUnique: async ({ where }) => ({ codigo: where.codigo, nombre: where.codigo, activa: true }), update: async ({ data }) => data, findMany: async () => ORIGINAL };
        const r = res();
        await ctrl.updateArea({ params: { codigo: 'GENERAL' }, body: { activa: false }, user: { id: 'c1' } }, r);
        assert.strictEqual(r.code, 409);
        prisma.user.count = async () => 2;
        prisma.ticket.count = async () => 1;
        const r2 = res();
        await ctrl.updateArea({ params: { codigo: 'WAN' }, body: { activa: false }, user: { id: 'c1' } }, r2);
        assert.strictEqual(r2.code, 409);
        assert.ok(r2.body.error.includes('2 usuarios activos y 1 tickets activos'));
        prisma.user.count = async () => 0;
        prisma.ticket.count = async () => 0;
        const r3 = res();
        await ctrl.updateArea({ params: { codigo: 'WAN' }, body: { activa: false, nombre: 'WAN Core' }, user: { id: 'c1' } }, r3);
        assert.strictEqual(r3.code, 200);
        assert.strictEqual(logs.pop().detalles, 'WAN: nombre: WAN → WAN Core, desactivada');
    });

    await t('Desactivar usuario: nunca a sí mismo ni con tickets activos', async () => {
        prisma.user.findUnique = async ({ where }) => ({ id: where.id, nombre: 'Ana', email: 'a@x.com', rol: 'OPERADOR', area_designada: 'WAN', activo: true });
        const r = res();
        await ctrl.updateUser({ params: { id: 'c1' }, body: { activo: false }, user: { id: 'c1' } }, r);
        assert.strictEqual(r.code, 409);
        prisma.ticket.count = async () => 3;
        const r2 = res();
        await ctrl.updateUser({ params: { id: 'o1' }, body: { activo: false }, user: { id: 'c1' } }, r2);
        assert.strictEqual(r2.code, 409);
        prisma.ticket.count = async () => 0;
        prisma.user.update = async () => ({ id: 'o1', nombre: 'Ana', email: 'a@x.com', rol: 'OPERADOR', area_designada: 'WAN' });
        const r3 = res();
        await ctrl.updateUser({ params: { id: 'o1' }, body: { activo: false }, user: { id: 'c1' } }, r3);
        assert.strictEqual(r3.code, 200);
        assert.strictEqual(logs.pop().detalles, 'Ana: desactivado');
    });

    await t('Usuario desactivado: no entra y se cierra su sesión', async () => {
        const auth = require('../src/controllers/authController');
        prisma.user.findUnique = async () => ({ id: 'o1', email: 'a@x.com', clave: 'abcd1234', rol: 'OPERADOR', activo: false });
        const r = res();
        await auth.login({ body: { email: 'a@x.com', clave: 'abcd1234' }, session: {} }, r);
        assert.strictEqual(r.code, 403);
        const requireAuth = require('../src/middlewares/requireAuth');
        let destruida = false;
        const r2 = res();
        await requireAuth({ session: { userId: 'o1', destroy: cb => { destruida = true; cb(); } }, originalUrl: '/' }, r2, () => { throw new Error('no debe pasar'); });
        assert.strictEqual(destruida, true);
        assert.strictEqual(r2.redir, '/auth/login');
    });

    cat.setAreas(ORIGINAL);
    console.log(`\n   RESUMEN: ${passed}/${total} pruebas pasaron correctamente\n`);
    if (passed !== total) process.exit(1);
})();
