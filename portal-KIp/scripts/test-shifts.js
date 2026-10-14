// Pruebas de turnos y guardias (servicio puro + controlador con prisma simulado).
const assert = require('assert');
const prisma = require('../src/config/prisma');
const S = require('../src/services/shiftService');
const ctrl = require('../src/controllers/turnoController');

let total = 0, passed = 0;
async function t(name, fn) {
    total++;
    try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); }
    catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); }
}
const mockRes = () => { const r = { code: 200, body: null }; r.status = c => { r.code = c; return r; }; r.json = b => { r.body = b; return r; }; return r; };
// Caracas = UTC-4. 2026-10-12 es lunes.
const at = (iso, hhmm) => new Date(`${iso}T${hhmm}:00-04:00`);

(async () => {
    console.log('\n=== PRUEBAS: TURNOS Y GUARDIAS ===\n');

    await t('validateSchedule acepta y ordena días', () => {
        const r = S.validateSchedule({ dias: [3, 1, 1, 2], inicio: '08:00', fin: '17:00' });
        assert.deepStrictEqual(r.horario.dias, [1, 2, 3]);
    });
    await t('validateSchedule rechaza horas invertidas, formato y días', () => {
        assert.ok(S.validateSchedule({ dias: [1], inicio: '17:00', fin: '08:00' }).error);
        assert.ok(S.validateSchedule({ dias: [1], inicio: '8:00', fin: '17:00' }).error);
        assert.ok(S.validateSchedule({ dias: [], inicio: '08:00', fin: '17:00' }).error);
        assert.ok(S.validateSchedule({ dias: [7], inicio: '08:00', fin: '17:00' }).error);
    });
    await t('Lunes 10:00 disponible → En turno y disponible', () => {
        const r = S.getShiftStatus({ estadoOperativo: 'DISPONIBLE' }, at('2026-10-12', '10:00'));
        assert.strictEqual(r.codigo, 'EN_TURNO'); assert.ok(r.disponible);
    });
    await t('Lunes 18:00 sin guardia → Fuera de turno', () => {
        assert.strictEqual(S.getShiftStatus({ estadoOperativo: 'DISPONIBLE' }, at('2026-10-12', '18:00')).codigo, 'FUERA_DE_TURNO');
    });
    await t('Sábado 10:00 sin guardia → Fuera de turno', () => {
        assert.strictEqual(S.getShiftStatus({ estadoOperativo: 'DISPONIBLE' }, at('2026-10-17', '10:00')).codigo, 'FUERA_DE_TURNO');
    });
    await t('Guardia en jornada normal → De guardia, no disponible, puede recibir', () => {
        const r = S.getShiftStatus({ estadoOperativo: 'DISPONIBLE', deGuardia: true }, at('2026-10-12', '10:00'));
        assert.strictEqual(r.codigo, 'DE_GUARDIA'); assert.strictEqual(r.disponible, false); assert.ok(r.enTurno);
    });
    await t('Guardia lunes 20:00 → De guardia; 03:00 → Fuera de turno', () => {
        assert.strictEqual(S.getShiftStatus({ estadoOperativo: 'DISPONIBLE', deGuardia: true }, at('2026-10-12', '20:00')).codigo, 'DE_GUARDIA');
        assert.strictEqual(S.getShiftStatus({ estadoOperativo: 'DISPONIBLE', deGuardia: true }, at('2026-10-12', '03:00')).codigo, 'FUERA_DE_TURNO');
    });
    await t('Guardia domingo 12:00 → En casa de guardia', () => {
        assert.strictEqual(S.getShiftStatus({ estadoOperativo: 'DISPONIBLE', deGuardia: true }, at('2026-10-18', '12:00')).codigo, 'EN_CASA_GUARDIA');
    });
    await t('Ausente prevalece, incluso de guardia', () => {
        assert.strictEqual(S.getShiftStatus({ estadoOperativo: 'AUSENTE', deGuardia: true }, at('2026-10-12', '10:00')).codigo, 'AUSENTE');
    });
    await t('Horario personalizado (martes a sábado 10-19)', () => {
        const horario = { dias: [2, 3, 4, 5, 6], inicio: '10:00', fin: '19:00' };
        assert.strictEqual(S.getShiftStatus({ estadoOperativo: 'DISPONIBLE', horario }, at('2026-10-12', '10:00')).codigo, 'FUERA_DE_TURNO'); // lunes
        assert.strictEqual(S.getShiftStatus({ estadoOperativo: 'DISPONIBLE', horario }, at('2026-10-13', '18:00')).codigo, 'EN_TURNO');
    });
    await t('getWeekStart devuelve el lunes 00:00 Caracas', () => {
        const w = S.getWeekStart(at('2026-10-15', '12:00'));
        assert.strictEqual(w.toISOString(), '2026-10-12T04:00:00.000Z');
    });

    // --- Controlador ---
    const audits = [];
    prisma.auditLog = { create: async ({ data }) => { audits.push(data); } };
    const user = { id: 'c1', rol: 'COORDINADOR' };

    await t('setGuardia: reemplaza la guardia por día de la semana y audita', async () => {
        let deleted, created;
        prisma.user.findMany = async () => [{ id: 'u1' }, { id: 'u2' }];
        prisma.guardiaDia = { deleteMany: async a => { deleted = a; return a; }, createMany: async a => { created = a; return a; } };
        prisma.$transaction = async ops => Promise.all(ops);
        const res = mockRes();
        await ctrl.setGuardia({ body: { semana: '2026-10-14', dias: { '2026-10-13': ['u1', 'u1'], '2026-10-15': ['u2'], '2026-10-17': ['u1', 'u2'] } }, user }, res);
        assert.strictEqual(res.code, 200);
        assert.strictEqual(deleted.where.fecha.gte.toISOString(), '2026-10-12T04:00:00.000Z');
        assert.strictEqual(deleted.where.fecha.lt.toISOString(), '2026-10-19T04:00:00.000Z');
        assert.deepStrictEqual(created.data.map(d => [d.userId, d.fecha.toISOString()]), [
            ['u1', '2026-10-13T04:00:00.000Z'], ['u2', '2026-10-15T04:00:00.000Z'], ['u1', '2026-10-17T04:00:00.000Z'], ['u2', '2026-10-17T04:00:00.000Z']
        ]);
        assert.strictEqual(audits.pop().accion, 'GUARDIA_DEFINIDA');
        // Lista simple de personas = los 7 días
        prisma.user.findMany = async () => [{ id: 'u1' }];
        await ctrl.setGuardia({ body: { semana: '2026-10-14', operatorIds: ['u1'] }, user }, mockRes());
        assert.strictEqual(created.data.length, 7);
        const fuera = mockRes();
        await ctrl.setGuardia({ body: { semana: '2026-10-14', dias: { '2026-10-20': ['u1'] } }, user }, fuera);
        assert.strictEqual(fuera.code, 400, 'fecha de otra semana');
    });
    await t('setGuardia: rechaza ids que no son operadores', async () => {
        prisma.user.findMany = async () => [{ id: 'u1' }];
        const res = mockRes();
        await ctrl.setGuardia({ body: { operatorIds: ['u1', 'zz'] }, user }, res);
        assert.strictEqual(res.code, 400);
    });
    await t('setGuardia: rechaza ids numéricos (los usuarios usan UUID)', async () => {
        const res = mockRes();
        await ctrl.setGuardia({ body: { operatorIds: [1] }, user }, res);
        assert.strictEqual(res.code, 400);
    });
    await t('setHorario: valida y hace upsert', async () => {
        let up;
        prisma.user.findFirst = async () => ({ id: 'u5' });
        prisma.horarioOperador = { upsert: async a => { up = a; } };
        const bad = mockRes();
        await ctrl.setHorario({ params: { operatorId: 'u5' }, body: { dias: [1], inicio: '18:00', fin: '09:00' }, user }, bad);
        assert.strictEqual(bad.code, 400);
        const ok = mockRes();
        await ctrl.setHorario({ params: { operatorId: 'u5' }, body: { dias: [1, 2], inicio: '09:00', fin: '18:00' }, user }, ok);
        assert.strictEqual(ok.code, 200);
        assert.strictEqual(up.create.hora_inicio, '09:00');
        assert.strictEqual(audits.pop().accion, 'HORARIO_EDITADO');
    });
    await t('loadShiftData: de guardia hoy y por día de la semana', async () => {
        const now = new Date('2026-10-14T16:00:00Z'); // miércoles
        prisma.horarioOperador = { findMany: async () => [] };
        prisma.guardiaDia = { findMany: async () => [
            { userId: 'u1', fecha: new Date('2026-10-14T04:00:00Z') },
            { userId: 'u2', fecha: new Date('2026-10-17T04:00:00Z') }
        ] };
        const d = await ctrl.loadShiftData(new Date('2026-10-12T04:00:00Z'), now);
        assert.deepStrictEqual([...d.guardiaIds], ['u1'], 'solo hoy');
        assert.deepStrictEqual([...d.guardiaPorDia.get('2026-10-17')], ['u2']);
    });
    await t('loadShiftData tolera tablas inexistentes', async () => {
        prisma.horarioOperador = { findMany: async () => { throw new Error('no existe'); } };
        prisma.guardiaDia = { findMany: async () => [] };
        const d = await ctrl.loadShiftData(new Date());
        assert.strictEqual(d.guardiaIds.size, 0);
        assert.strictEqual(d.guardiaPorDia.size, 7);
    });

    console.log(`\nResultado: ${passed}/${total}`);
    process.exit(passed === total ? 0 : 1);
})();
