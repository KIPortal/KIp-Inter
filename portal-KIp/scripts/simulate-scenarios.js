/**
 * Simulation Script for Ticket Assignment and Lifecycle Scenarios
 * 
 * Scenario 1: Coordinador asigna -> Operador toma -> Operador pausa -> Operador cierra
 * Scenario 2: Coordinador asigna -> Coordinador desasigna (vuelve a NUEVO)
 * Scenario 3: Casos límite y reasignación masiva tras desasignar (verificación de robustez)
 */

const assert = require('assert');

// Mock Prisma store for in-memory end-to-end execution of controller logic
function createMockPrisma() {
    const db = {
        users: [
            { id: 'coord-1', nombre: 'Coordinador NOC', email: 'coord@noc.com', rol: 'COORDINADOR', area_designada: 'GENERAL', estado_operativo: 'DISPONIBLE' },
            { id: 'op-1', nombre: 'Operador Redes', email: 'op@noc.com', rol: 'OPERADOR', area_designada: 'REDES_FTTH', estado_operativo: 'DISPONIBLE' },
            { id: 'op-gen', nombre: 'Operador General', email: 'opgen@noc.com', rol: 'OPERADOR', area_designada: 'GENERAL', estado_operativo: 'DISPONIBLE' },
            { id: 'op-wan', nombre: 'Operador WAN', email: 'opwan@noc.com', rol: 'OPERADOR', area_designada: 'WAN', estado_operativo: 'DISPONIBLE' }
        ],
        tickets: [],
        auditLogs: [],
        adjuntos: []
    };

    const mockPrisma = {
        user: {
            findFirst: async ({ where }) => {
                return db.users.find(u => {
                    if (where.id && u.id !== where.id) return false;
                    if (where.rol && u.rol !== where.rol) return false;
                    return true;
                }) || null;
            },
            findUnique: async ({ where }) => {
                return db.users.find(u => u.id === where.id || u.email === where.email) || null;
            },
            findMany: async () => [...db.users],
            update: async ({ where, data }) => {
                const u = db.users.find(user => user.id === where.id);
                if (u && data?.tickets_resueltos?.increment) {
                    u.tickets_resueltos = (u.tickets_resueltos || 0) + data.tickets_resueltos.increment;
                }
                return u || null;
            },
            count: async () => db.users.length
        },
        ticket: {
            create: async ({ data, include }) => {
                const item = {
                    id: 'ticket-' + (db.tickets.length + 1),
                    codigo_incidencia: data.codigo_incidencia,
                    asunto: data.asunto,
                    descripcion: data.descripcion || null,
                    remitente: data.remitente || null,
                    estado_actual: data.estado_actual || 'NUEVO',
                    puntos_complejidad: data.puntos_complejidad || 0,
                    area_designada: data.area_designada || 'GENERAL',
                    origen_ingesta: data.origen_ingesta || 'CORREO',
                    creado_por_id: data.creado_por_id || null,
                    asignado_a_id: data.asignado_a_id || null,
                    fecha_asignacion: data.fecha_asignacion || null,
                    fecha_cierre: data.fecha_cierre || null,
                    resueltoEn: data.resueltoEn || null,
                    createdAt: new Date(),
                    updatedAt: new Date()
                };
                if (data.adjuntos?.create) {
                    const toCreate = Array.isArray(data.adjuntos.create) ? data.adjuntos.create : [data.adjuntos.create];
                    toCreate.forEach(att => {
                        db.adjuntos.push({
                            id: 'adjunto-' + (db.adjuntos.length + 1),
                            ticketId: item.id,
                            ...att,
                            createdAt: new Date()
                        });
                    });
                }
                db.tickets.push(item);
                const clone = { ...item };
                if (include?.adjuntos) {
                    clone.adjuntos = db.adjuntos.filter(a => a.ticketId === item.id);
                }
                return clone;
            },
            findUnique: async ({ where, include }) => {
                const item = db.tickets.find(t => {
                    if (where.id && t.id === where.id) return true;
                    if (where.codigo_incidencia && t.codigo_incidencia === where.codigo_incidencia) return true;
                    return false;
                });
                if (!item) return null;
                const clone = { ...item };
                if (include?.asignado_a) {
                    clone.asignado_a = db.users.find(u => u.id === item.asignado_a_id) || null;
                }
                if (include?.adjuntos) {
                    clone.adjuntos = db.adjuntos.filter(a => a.ticketId === item.id);
                }
                return clone;
            },
            findMany: async ({ where, include } = {}) => {
                let list = [...db.tickets];
                if (where?.codigo_incidencia?.in) {
                    list = list.filter(t => where.codigo_incidencia.in.includes(t.codigo_incidencia));
                }
                if (include?.adjuntos) {
                    list = list.map(t => ({
                        ...t,
                        adjuntos: db.adjuntos.filter(a => a.ticketId === t.id)
                    }));
                }
                return list;
            },
            updateMany: async ({ where, data }) => {
                let count = 0;
                db.tickets.forEach(t => {
                    let match = true;
                    if (where.id && t.id !== where.id) match = false;
                    if (where.codigo_incidencia) {
                        if (typeof where.codigo_incidencia === 'object' && Array.isArray(where.codigo_incidencia.in)) {
                            if (!where.codigo_incidencia.in.includes(t.codigo_incidencia)) match = false;
                        } else if (typeof where.codigo_incidencia === 'object' && Array.isArray(where.codigo_incidencia.notIn)) {
                            if (where.codigo_incidencia.notIn.includes(t.codigo_incidencia)) match = false;
                        } else if (t.codigo_incidencia !== where.codigo_incidencia) {
                            match = false;
                        }
                    }
                    if (where.estado_actual) {
                        if (typeof where.estado_actual === 'object' && where.estado_actual.not) {
                            if (t.estado_actual === where.estado_actual.not) match = false;
                        } else if (typeof where.estado_actual === 'object' && Array.isArray(where.estado_actual.notIn)) {
                            if (where.estado_actual.notIn.includes(t.estado_actual)) match = false;
                        } else if (typeof where.estado_actual === 'object' && Array.isArray(where.estado_actual.in)) {
                            if (!where.estado_actual.in.includes(t.estado_actual)) match = false;
                        } else if (t.estado_actual !== where.estado_actual) {
                            match = false;
                        }
                    }
                    if (where.asignado_a_id !== undefined) {
                        if (t.asignado_a_id !== where.asignado_a_id) match = false;
                    }
                    if (where.OR) {
                        const orMatch = where.OR.some(cond => {
                            if ('asignado_a_id' in cond) return t.asignado_a_id === cond.asignado_a_id;
                            return true;
                        });
                        if (!orMatch) match = false;
                    }
                    if (where.area_designada) {
                        if (where.area_designada.in && !where.area_designada.in.includes(t.area_designada)) match = false;
                    }

                    if (match) {
                        count++;
                        Object.assign(t, data, { updatedAt: new Date() });
                    }
                });
                return { count };
            },
            count: async ({ where } = {}) => {
                let list = [...db.tickets];
                if (where?.estado_actual?.not) {
                    list = list.filter(t => t.estado_actual !== where.estado_actual.not);
                } else if (where?.estado_actual) {
                    list = list.filter(t => t.estado_actual === where.estado_actual);
                }
                return list.length;
            }
        },
        adjunto: {
            create: async ({ data }) => {
                const item = {
                    id: 'adjunto-' + (db.adjuntos.length + 1),
                    ...data,
                    createdAt: new Date()
                };
                db.adjuntos.push(item);
                return item;
            },
            createMany: async ({ data }) => {
                const list = Array.isArray(data) ? data : [data];
                list.forEach(d => {
                    db.adjuntos.push({
                        id: 'adjunto-' + (db.adjuntos.length + 1),
                        ...d,
                        createdAt: new Date()
                    });
                });
                return { count: list.length };
            },
            findMany: async ({ where } = {}) => {
                let list = [...db.adjuntos];
                if (where?.ticketId) {
                    list = list.filter(a => a.ticketId === where.ticketId);
                }
                return list;
            }
        },
        auditLog: {
            create: async ({ data }) => {
                if (data.userId && typeof data.userId === 'string' && data.userId.startsWith('temporary:')) {
                    const error = new Error('Foreign key constraint failed on the field: userId');
                    error.code = 'P2003';
                    throw error;
                }
                db.auditLogs.push({ id: 'audit-' + (db.auditLogs.length + 1), ...data, createdAt: new Date() });
                return true;
            },
            createMany: async ({ data }) => {
                data.forEach(d => {
                    if (d.userId && typeof d.userId === 'string' && d.userId.startsWith('temporary:')) {
                        const error = new Error('Foreign key constraint failed on the field: userId');
                        error.code = 'P2003';
                        throw error;
                    }
                    db.auditLogs.push({ id: 'audit-' + (db.auditLogs.length + 1), ...d, createdAt: new Date() });
                });
                return { count: data.length };
            }
        },
        $transaction: async (arg) => {
            if (typeof arg === 'function') {
                return arg(mockPrisma);
            }
            return Promise.all(arg);
        },
        _db: db
    };

    return mockPrisma;
}

// Helper to create mock Express req/res
function createMockHttp({ body = {}, params = {}, query = {}, user = null, app = null, files = [] } = {}) {
    let statusCode = 200;
    let jsonResponse = null;

    const res = {
        status(code) {
            statusCode = code;
            return res;
        },
        json(data) {
            jsonResponse = data;
            return res;
        },
        getStatusCode: () => statusCode,
        getResponse: () => jsonResponse
    };

    const socketEvents = [];
    const mockIo = {
        emit(event, data) {
            socketEvents.push({ room: 'global', event, data });
        },
        to(room) {
            return {
                emit(event, data) {
                    socketEvents.push({ room, event, data });
                }
            };
        },
        getEvents: () => socketEvents
    };

    const req = {
        body,
        params,
        query,
        user,
        files,
        app: app || { get: (key) => key === 'io' ? mockIo : null }
    };

    return { req, res, mockIo };
}

async function runSimulations() {
    console.log('========================================================');
    console.log(' INICIANDO SIMULACIONES DE TICKET CONTROLLER');
    console.log('========================================================\n');

    // Inyectar mock prisma en ticketController
    const mockPrisma = createMockPrisma();
    delete require.cache[require.resolve('../src/controllers/ticketController')];
    delete require.cache[require.resolve('../src/config/prisma')];
    require.cache[require.resolve('../src/config/prisma')] = {
        id: require.resolve('../src/config/prisma'),
        filename: require.resolve('../src/config/prisma'),
        loaded: true,
        exports: mockPrisma
    };
    const ticketController = require('../src/controllers/ticketController');

    // ------------------------------------------------------------------------
    // SETUP: Crear tickets iniciales en estado NUEVO
    // ------------------------------------------------------------------------
    console.log('[SETUP] Creando tickets iniciales para pruebas...');
    await mockPrisma.ticket.create({
        data: {
            codigo_incidencia: 'INC-101',
            asunto: 'Falla masiva FTTH GPON Pon-01',
            area_designada: 'REDES_FTTH',
            origen_ingesta: 'CORREO',
            estado_actual: 'NUEVO',
            puntos_complejidad: 0
        }
    });

    await mockPrisma.ticket.create({
        data: {
            codigo_incidencia: 'INC-102',
            asunto: 'Saturación de enlace WAN Core',
            area_designada: 'GENERAL',
            origen_ingesta: 'JEFATURA',
            estado_actual: 'NUEVO',
            puntos_complejidad: 0
        }
    });

    await mockPrisma.ticket.create({
        data: {
            codigo_incidencia: 'INC-103',
            asunto: 'Incidencia en troncal Telefonia IP',
            area_designada: 'GENERAL',
            origen_ingesta: 'LLAMADA',
            estado_actual: 'NUEVO',
            puntos_complejidad: 0
        }
    });

    await mockPrisma.ticket.create({
        data: {
            codigo_incidencia: 'INC-104',
            asunto: 'Corte de fibra Backbone WAN',
            area_designada: 'WAN',
            origen_ingesta: 'JEFATURA',
            estado_actual: 'NUEVO',
            puntos_complejidad: 0
        }
    });

    console.log(`- Ticket 1: INC-101 [NUEVO]`);
    console.log(`- Ticket 2: INC-102 [NUEVO]`);
    console.log(`- Ticket 3: INC-103 [NUEVO]`);
    console.log(`- Ticket 4: INC-104 [NUEVO]\n`);

    // ========================================================================
    // FLUJO 1: Coordinador asigna -> Operador toma -> Operador pausa -> Operador cierra
    // ========================================================================
    console.log('>>> EJECUTANDO FLUJO 1:');
    console.log('    Coordinador asigna -> Operador Toma -> Operador Pausa -> Operador Cierra');

    // Paso 1.1: Coordinador asigna INC-101 a op-1
    {
        const { req, res, mockIo } = createMockHttp({
            body: { ticketCode: 'INC-101', operatorId: 'op-1', areaDesignada: 'REDES_FTTH', prioridad: 'P1' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.assignTicket(req, res);
        const resp = res.getResponse();
        assert.strictEqual(res.getStatusCode(), 200, 'HTTP status debe ser 200 al asignar');
        assert.strictEqual(resp.success, true, 'Respuesta debe ser exitosa');
        assert.strictEqual(resp.ticket.estado_actual, 'ASIGNADO', 'Ticket debe estar en estado ASIGNADO');
        assert.strictEqual(resp.ticket.asignado_a_id, 'op-1', 'Ticket debe estar asignado a op-1');
        assert.strictEqual(resp.ticket.puntos_complejidad, 8, 'Puntos de prioridad P1 deben ser 8');
        const assignedEvent = mockIo.getEvents().find(e => e.room === 'user_op-1' && e.event === 'ticket_assigned');
        assert.ok(assignedEvent, 'Debe emitir evento ticket_assigned al operador op-1');
        assert.strictEqual(assignedEvent.data.codigo_incidencia, 'INC-101');
        console.log(`  [Paso 1.1 - Asignar]:   OK! Estado -> ${resp.ticket.estado_actual}, Asignado a -> ${resp.ticket.asignado_a_id}, Puntos -> ${resp.ticket.puntos_complejidad}`);
    }

    // Paso 1.2: Operador toma (claim) INC-101
    {
        const { req, res } = createMockHttp({
            params: { ticketCode: 'INC-101' },
            user: { id: 'op-1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' }
        });
        await ticketController.claimTicket(req, res);
        const resp = res.getResponse();
        assert.strictEqual(res.getStatusCode(), 200, 'HTTP status debe ser 200 al tomar ticket');
        assert.strictEqual(resp.success, true, 'Respuesta debe ser exitosa');
        assert.strictEqual(resp.ticket.estado_actual, 'EN_PROGRESO', 'Ticket debe cambiar a EN_PROGRESO');
        console.log(`  [Paso 1.2 - Tomar]:     OK! Estado -> ${resp.ticket.estado_actual}, Asignado a -> ${resp.ticket.asignado_a_id}`);
    }

    // Paso 1.3: Operador pausa INC-101 vía updateOperatorStatus (simulando UI)
    {
        const { req, res } = createMockHttp({
            params: { ticketCode: 'INC-101' },
            body: { status: 'EN_PAUSA' },
            user: { id: 'op-1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' }
        });
        await ticketController.updateOperatorStatus(req, res);
        const resp = res.getResponse();
        assert.strictEqual(res.getStatusCode(), 200, 'HTTP status debe ser 200 al pausar');
        assert.strictEqual(resp.success, true, 'Respuesta debe ser exitosa');
        assert.strictEqual(resp.ticket.estado_actual, 'EN_PAUSA', 'Ticket debe cambiar a EN_PAUSA');
        console.log(`  [Paso 1.3 - Pausar]:    OK! Estado -> ${resp.ticket.estado_actual}`);
    }

    // Paso 1.4: Operador resuelve INC-101 vía resolveTicket -> estado RESUELTO
    {
        const { req, res } = createMockHttp({
            params: { ticketCode: 'INC-101' },
            user: { id: 'op-1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' }
        });
        await ticketController.resolveTicket(req, res);
        const resp = res.getResponse();
        assert.strictEqual(res.getStatusCode(), 200, 'HTTP status debe ser 200 al resolver');
        assert.strictEqual(resp.success, true, 'Respuesta debe ser exitosa');
        assert.strictEqual(resp.ticket.estado_actual, 'RESUELTO', 'Ticket debe cambiar a RESUELTO');
        assert.ok(resp.ticket.resueltoEn, 'Debe registrar resueltoEn');
        console.log(`  [Paso 1.4 - Resolver]:   OK! Estado -> ${resp.ticket.estado_actual}, Resuelto En -> ${resp.ticket.resueltoEn}`);
    }

    // Paso 1.5: Coordinador confirma y cierra definitivamente INC-101 vía confirmCloseTicket
    {
        const { req, res } = createMockHttp({
            params: { ticketCode: 'INC-101' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.confirmCloseTicket(req, res);
        const resp = res.getResponse();
        assert.strictEqual(res.getStatusCode(), 200, 'HTTP status debe ser 200 al confirmar cierre');
        assert.strictEqual(resp.success, true, 'Respuesta debe ser exitosa');
        assert.strictEqual(resp.ticket.estado_actual, 'CERRADO', 'Ticket debe cambiar a CERRADO tras confirmación del coordinador');
        assert.ok(resp.ticket.fecha_cierre, 'Debe registrar fecha_cierre');
        console.log(`  [Paso 1.5 - Confirmar Cierre]: OK! Estado -> ${resp.ticket.estado_actual}, Fecha Cierre -> ${resp.ticket.fecha_cierre}`);
    }

    // Verificación directa de persistencia en Prisma para Flujo 1
    const ticket1InDb = await mockPrisma.ticket.findUnique({ where: { codigo_incidencia: 'INC-101' } });
    assert.strictEqual(ticket1InDb.estado_actual, 'CERRADO', 'Estado en BD debe ser CERRADO');
    assert.ok(ticket1InDb.fecha_cierre, 'fecha_cierre en BD debe estar registrada');
    assert.ok(ticket1InDb.resueltoEn, 'resueltoEn en BD debe estar registrada');
    console.log(`  [Persistencia en DB Flujo 1]: OK! Ticket ${ticket1InDb.codigo_incidencia} verificado en BD como CERRADO con marcas de tiempo.`);

    console.log('>>> FLUJO 1 COMPLETADO EXITOSAMENTE (NUEVO -> ASIGNADO -> EN_PROGRESO -> EN_PAUSA -> RESUELTO -> CERRADO)\n');

    // ========================================================================
    // FLUJO 2: Coordinador asigna -> Coordinador desasigna (vuelve a NUEVO)
    // ========================================================================
    console.log('>>> EJECUTANDO FLUJO 2:');
    console.log('    Coordinador asigna -> Coordinador desasigna (vuelve a NUEVO)');

    // Paso 2.1: Coordinador asigna INC-102 a op-gen
    {
        const { req, res } = createMockHttp({
            body: { ticketCode: 'INC-102', operatorId: 'op-gen', areaDesignada: 'GENERAL', prioridad: 'P2' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.assignTicket(req, res);
        const resp = res.getResponse();
        assert.strictEqual(res.getStatusCode(), 200, 'HTTP status debe ser 200 al asignar');
        assert.strictEqual(resp.success, true, 'Respuesta debe ser exitosa');
        assert.strictEqual(resp.ticket.estado_actual, 'ASIGNADO', 'Ticket debe estar en estado ASIGNADO');
        assert.strictEqual(resp.ticket.asignado_a_id, 'op-gen', 'Ticket debe estar asignado a op-gen');
        console.log(`  [Paso 2.1 - Asignar]:   OK! Estado -> ${resp.ticket.estado_actual}, Asignado a -> ${resp.ticket.asignado_a_id}`);
    }

    // Paso 2.2: Coordinador desasigna INC-102
    {
        const { req, res, mockIo } = createMockHttp({
            body: { ticketCode: 'INC-102' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.unassignTicket(req, res);
        const resp = res.getResponse();
        assert.strictEqual(res.getStatusCode(), 200, 'HTTP status debe ser 200 al desasignar');
        assert.strictEqual(resp.success, true, 'Respuesta debe ser exitosa');
        assert.strictEqual(resp.ticket.estado_actual, 'NUEVO', 'Ticket DEBE regresar a estado NUEVO');
        assert.strictEqual(resp.ticket.asignado_a_id, null, 'asignado_a_id DEBE ser null');
        assert.strictEqual(resp.ticket.fecha_asignacion, null, 'fecha_asignacion DEBE ser null');
        assert.strictEqual(resp.ticket.puntos_complejidad, 0, 'puntos_complejidad DEBE ser 0');
        const unassignedEvent = mockIo.getEvents().find(e => e.room === 'user_op-gen' && e.event === 'ticket_unassigned');
        assert.ok(unassignedEvent, 'Debe emitir evento ticket_unassigned al operador anterior op-gen');
        assert.strictEqual(unassignedEvent.data.codigo_incidencia, 'INC-102');
        console.log(`  [Paso 2.2 - Desasignar]: OK! Estado -> ${resp.ticket.estado_actual}, Asignado a -> ${resp.ticket.asignado_a_id}, Puntos -> ${resp.ticket.puntos_complejidad}`);
    }

    // Verificación directa de persistencia en Prisma
    const ticketInDb = await mockPrisma.ticket.findUnique({ where: { codigo_incidencia: 'INC-102' } });
    assert.strictEqual(ticketInDb.estado_actual, 'NUEVO', 'Estado en BD debe ser NUEVO');
    assert.strictEqual(ticketInDb.asignado_a_id, null, 'asignado_a_id en BD debe ser null');
    assert.strictEqual(ticketInDb.puntos_complejidad, 0, 'puntos_complejidad en BD debe ser 0');
    console.log(`  [Persistencia en DB]:    OK! Ticket ${ticketInDb.codigo_incidencia} verificado en BD como ${ticketInDb.estado_actual} sin operador.`);

    console.log('>>> FLUJO 2 COMPLETADO EXITOSAMENTE (NUEVO -> ASIGNADO -> NUEVO)\n');

    // ========================================================================
    // FLUJO 3: Casos Límite, Reasignación Masiva y Robustez
    // ========================================================================
    console.log('>>> EJECUTANDO FLUJO 3 (CASOS LÍMITE Y VALIDACIONES AVANZADAS):');

    // Paso 3.1: Re-asignación masiva del ticket desasignado (INC-102) junto con INC-103
    {
        const { req, res } = createMockHttp({
            body: {
                ticketCodes: ['INC-102', 'INC-103'],
                operatorId: 'op-1',
                areaDesignada: 'REDES_FTTH',
                prioridad: 'P3'
            },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.batchAssignTickets(req, res);
        const resp = res.getResponse();
        assert.strictEqual(res.getStatusCode(), 200, 'HTTP status debe ser 200 en reasignación masiva tras desasignar');
        assert.strictEqual(resp.success, true, 'batchAssignTickets debe reportar success: true');
        assert.strictEqual(resp.count, 2, 'Debe haber asignado 2 tickets');

        const t102 = await mockPrisma.ticket.findUnique({ where: { codigo_incidencia: 'INC-102' } });
        const t103 = await mockPrisma.ticket.findUnique({ where: { codigo_incidencia: 'INC-103' } });
        assert.strictEqual(t102.estado_actual, 'ASIGNADO');
        assert.strictEqual(t102.asignado_a_id, 'op-1');
        assert.strictEqual(t103.estado_actual, 'ASIGNADO');
        assert.strictEqual(t103.asignado_a_id, 'op-1');
        console.log(`  [Paso 3.1 - Batch Re-assign tras Desasignar]: OK! Tickets reasignados correctamente a ${t102.asignado_a_id}`);
    }

    // Paso 3.2: Intento de desasignar un ticket ya CERRADO (INC-101) -> debe retornar 409
    {
        const { req, res } = createMockHttp({
            body: { ticketCode: 'INC-101' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.unassignTicket(req, res);
        assert.strictEqual(res.getStatusCode(), 409, 'Desasignar ticket cerrado debe retornar 409');
        assert.strictEqual(res.getResponse().success, false);
        console.log(`  [Paso 3.2 - Desasignar ticket cerrado]:  OK! Retornó 409 (${res.getResponse().error})`);
    }

    // Paso 3.3: Intento de reasignar un ticket ya CERRADO (INC-101) -> debe retornar 409
    {
        const { req, res } = createMockHttp({
            body: { ticketCode: 'INC-101', operatorId: 'op-1' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.assignTicket(req, res);
        assert.strictEqual(res.getStatusCode(), 409, 'Asignar ticket cerrado debe retornar 409');
        assert.strictEqual(res.getResponse().success, false);
        console.log(`  [Paso 3.3 - Asignar ticket cerrado]:     OK! Retornó 409 (${res.getResponse().error})`);
    }

    // Paso 3.4: Asignación cruzada de área: Coordinador asigna INC-104 (área WAN) a op-gen (área GENERAL).
    // El operador op-gen DEBE poder tomarlo exitosamente porque el coordinador se lo asignó a él.
    {
        const { req: assignReq, res: assignRes } = createMockHttp({
            body: { ticketCode: 'INC-104', operatorId: 'op-gen' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.assignTicket(assignReq, assignRes);
        assert.strictEqual(assignRes.getStatusCode(), 200);

        const { req: claimReq, res: claimRes } = createMockHttp({
            params: { ticketCode: 'INC-104' },
            user: { id: 'op-gen', rol: 'OPERADOR', area_designada: 'GENERAL' }
        });
        await ticketController.claimTicket(claimReq, claimRes);
        assert.strictEqual(claimRes.getStatusCode(), 200, 'Operador debe poder reclamar ticket asignado directamente por coordinador');
        assert.strictEqual(claimRes.getResponse().ticket.estado_actual, 'EN_PROGRESO');
        console.log(`  [Paso 3.4 - Claim asignación cruzada]:   OK! Ticket de área WAN tomado exitosamente por operador GENERAL`);
    }

    // Paso 3.5: Operador no asignado intentando auto-reclamar un ticket nuevo de un área ajena
    {
        await mockPrisma.ticket.create({
            data: {
                codigo_incidencia: 'INC-105',
                asunto: 'Incidencia WAN sin asignar',
                area_designada: 'WAN',
                estado_actual: 'NUEVO'
            }
        });
        const { req, res } = createMockHttp({
            params: { ticketCode: 'INC-105' },
            user: { id: 'op-1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' }
        });
        await ticketController.claimTicket(req, res);
        assert.strictEqual(res.getStatusCode(), 403, 'Operador de otra área no debe poder autoreclamar ticket no asignado');
        console.log(`  [Paso 3.5 - Restricción área en cola]:  OK! Retornó 403 (${res.getResponse().error})`);
    }

    // Paso 3.6: Sesión de coordinador temporal (temporary:coord@noc.com) no causa error 500 por Foreign Key
    {
        const { req: assignReq, res: assignRes } = createMockHttp({
            body: { ticketCode: 'INC-105', operatorId: 'op-wan', areaDesignada: 'WAN', prioridad: 'P1' },
            user: { id: 'temporary:coord@noc.com', rol: 'COORDINADOR' }
        });
        await ticketController.assignTicket(assignReq, assignRes);
        assert.strictEqual(assignRes.getStatusCode(), 200, 'Asignación con usuario temporal debe ser exitosa');
        assert.strictEqual(assignRes.getResponse().ticket.estado_actual, 'ASIGNADO');

        const { req: unassignReq, res: unassignRes } = createMockHttp({
            body: { ticketCode: 'INC-105' },
            user: { id: 'temporary:coord@noc.com', rol: 'COORDINADOR' }
        });
        await ticketController.unassignTicket(unassignReq, unassignRes);
        assert.strictEqual(unassignRes.getStatusCode(), 200, 'Desasignación con usuario temporal debe ser exitosa');
        assert.strictEqual(unassignRes.getResponse().ticket.estado_actual, 'NUEVO');
        assert.strictEqual(unassignRes.getResponse().ticket.asignado_a_id, null);
        console.log(`  [Paso 3.6 - Sesión temporal de usuario]: OK! Asignación y desasignación no fallaron por FK constraint.`);
    }

    // Paso 3.7: Reasignación directa entre operadores emite ticket_assigned y ticket_unassigned
    {
        // Primero asignamos a op-1
        const { req: req1, res: res1 } = createMockHttp({
            body: { ticketCode: 'INC-105', operatorId: 'op-1', areaDesignada: 'WAN' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.assignTicket(req1, res1);
        assert.strictEqual(res1.getStatusCode(), 200);

        // Ahora reasignamos a op-wan
        const { req: req2, res: res2, mockIo } = createMockHttp({
            body: { ticketCode: 'INC-105', operatorId: 'op-wan', areaDesignada: 'WAN' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.assignTicket(req2, res2);
        assert.strictEqual(res2.getStatusCode(), 200);
        assert.strictEqual(res2.getResponse().ticket.asignado_a_id, 'op-wan');

        const events = mockIo.getEvents();
        assert.ok(events.some(e => e.room === 'user_op-wan' && e.event === 'ticket_assigned'), 'Debe emitir ticket_assigned a nuevo operador op-wan');
        assert.ok(events.some(e => e.room === 'user_op-1' && e.event === 'ticket_unassigned'), 'Debe emitir ticket_unassigned al operador anterior op-1');
        console.log(`  [Paso 3.7 - Reasignación cruzada y Sockets]: OK! Notificaciones a ambos operadores emitidas correctamente.`);
    }

    // Paso 3.8: Normalización de ticketCode en minúsculas (insensibilidad a mayúsculas/minúsculas)
    {
        const { req, res } = createMockHttp({
            params: { ticketCode: 'inc-105' },
            user: { id: 'op-wan', rol: 'OPERADOR', area_designada: 'WAN' }
        });
        await ticketController.claimTicket(req, res);
        assert.strictEqual(res.getStatusCode(), 200, 'Debe procesar ticketCode en minúsculas');
        assert.strictEqual(res.getResponse().ticket.estado_actual, 'EN_PROGRESO');
        console.log(`  [Paso 3.8 - Normalización ticketCode]: OK! Código en minúsculas aceptado y procesado.`);
    }

    // Paso 3.9: Transición a EN_ESPERA_TERCEROS y sinónimos de actualización de estado
    {
        // Poner en espera de terceros usando el alias 'estado'
        const { req: waitReq, res: waitRes } = createMockHttp({
            params: { ticketCode: 'INC-105' },
            body: { estado: 'EN_ESPERA_TERCEROS' },
            user: { id: 'op-wan', rol: 'OPERADOR', area_designada: 'WAN' }
        });
        await ticketController.updateOperatorStatus(waitReq, waitRes);
        assert.strictEqual(waitRes.getStatusCode(), 200);
        assert.strictEqual(waitRes.getResponse().ticket.estado_actual, 'EN_ESPERA_TERCEROS');

        // Reanudar a EN_PROGRESO usando sinónimo REANUDAR
        const { req: resumeReq, res: resumeRes } = createMockHttp({
            params: { ticketCode: 'INC-105' },
            body: { status: 'REANUDAR' },
            user: { id: 'op-wan', rol: 'OPERADOR', area_designada: 'WAN' }
        });
        await ticketController.updateOperatorStatus(resumeReq, resumeRes);
        assert.strictEqual(resumeRes.getStatusCode(), 200);
        assert.strictEqual(resumeRes.getResponse().ticket.estado_actual, 'EN_PROGRESO');

        // Cerrar usando sinónimo RESUELTO -> pasa a RESUELTO
        const { req: closeReq, res: closeRes } = createMockHttp({
            params: { ticketCode: 'INC-105' },
            body: { status: 'RESUELTO' },
            user: { id: 'op-wan', rol: 'OPERADOR', area_designada: 'WAN' }
        });
        await ticketController.updateOperatorStatus(closeReq, closeRes);
        assert.strictEqual(closeRes.getStatusCode(), 200);
        assert.strictEqual(closeRes.getResponse().ticket.estado_actual, 'RESUELTO');

        // Coordinador confirma y cierra definitivamente
        const { req: confReq, res: confRes } = createMockHttp({
            params: { ticketCode: 'INC-105' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.confirmCloseTicket(confReq, confRes);
        assert.strictEqual(confRes.getStatusCode(), 200);
        assert.strictEqual(confRes.getResponse().ticket.estado_actual, 'CERRADO');
        console.log(`  [Paso 3.9 - Transiciones avanzadas y aliases]: OK! EN_ESPERA_TERCEROS -> REANUDAR -> RESUELTO -> CERRADO validados.`);
    }

    // Paso 3.10: Creación de ticket con usuario autenticado y con usuario temporal
    {
        // Con usuario normal
        const { req: createReq1, res: createRes1 } = createMockHttp({
            body: {
                asunto: 'Incidencia de prueba fibra',
                descripcion: 'Detalle de prueba',
                areaDesignada: 'REDES_FTTH',
                origenIngesta: 'LLAMADA',
                prioridad: 'P2'
            },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(createReq1, createRes1);
        assert.strictEqual(createRes1.getStatusCode(), 201);
        const created1 = createRes1.getResponse().ticket;
        assert.strictEqual(created1.estado_actual, 'NUEVO');
        assert.strictEqual(created1.puntos_complejidad, 5);
        assert.strictEqual(created1.creado_por_id, 'coord-1');

        // Con usuario temporal de desarrollo
        const { req: createReq2, res: createRes2 } = createMockHttp({
            body: {
                asunto: 'Incidencia de prueba correo',
                remitente: 'cliente@empresa.com',
                areaDesignada: 'GENERAL',
                origenIngesta: 'CORREO',
                prioridad: 'P1'
            },
            user: { id: 'temporary:dev@noc.com', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(createReq2, createRes2);
        assert.strictEqual(createRes2.getStatusCode(), 201);
        const created2 = createRes2.getResponse().ticket;
        assert.strictEqual(created2.estado_actual, 'NUEVO');
        assert.strictEqual(created2.puntos_complejidad, 8);
        assert.strictEqual(created2.creado_por_id, null, 'creado_por_id no debe almacenar temporary: para evitar FK error');

        // Con múltiples archivos adjuntos
        const { req: createReqFiles, res: createResFiles } = createMockHttp({
            body: {
                asunto: 'Incidencia con adjuntos múltiples',
                descripcion: 'Archivos de soporte',
                areaDesignada: 'REDES_FTTH',
                origenIngesta: 'COORDINADOR',
                prioridad: 'P1'
            },
            files: [
                {
                    originalname: 'diagrama_red.png',
                    filename: '1700000000000-diagrama_red.png',
                    path: 'public/uploads/1700000000000-diagrama_red.png',
                    mimetype: 'image/png',
                    size: 204800
                },
                {
                    originalname: 'logs_olt.txt',
                    filename: '1700000000001-logs_olt.txt',
                    path: 'public/uploads/1700000000001-logs_olt.txt',
                    mimetype: 'text/plain',
                    size: 10240
                }
            ],
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(createReqFiles, createResFiles);
        assert.strictEqual(createResFiles.getStatusCode(), 201);
        const createdFilesTicket = createResFiles.getResponse().ticket;
        assert.ok(createdFilesTicket.adjuntos, 'Debe incluir lista de adjuntos');
        assert.strictEqual(createdFilesTicket.adjuntos.length, 2, 'Debe haber 2 adjuntos asociados');
        assert.strictEqual(createdFilesTicket.adjuntos[0].nombre_original, 'diagrama_red.png');
        assert.strictEqual(createdFilesTicket.adjuntos[1].nombre_original, 'logs_olt.txt');
        console.log(`  [Paso 3.10 - Creación de tickets y adjuntos]: OK! Tickets y 2 adjuntos creados correctamente (${created1.codigo_incidencia}, ${created2.codigo_incidencia}, ${createdFilesTicket.codigo_incidencia}).`);
    }

    // Paso 3.11: Asignación masiva desacoplada de fallos secundarios de auditoría
    {
        await mockPrisma.ticket.create({
            data: { codigo_incidencia: 'INC-110', asunto: 'Test 110', area_designada: 'REDES_FTTH', estado_actual: 'NUEVO' }
        });
        await mockPrisma.ticket.create({
            data: { codigo_incidencia: 'INC-111', asunto: 'Test 111', area_designada: 'REDES_FTTH', estado_actual: 'NUEVO' }
        });

        const { req, res } = createMockHttp({
            body: {
                ticketCodes: ['INC-110', 'INC-111'],
                operatorId: 'op-1',
                areaDesignada: 'REDES_FTTH',
                prioridad: 'P2'
            },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.batchAssignTickets(req, res);
        assert.strictEqual(res.getStatusCode(), 200);
        assert.strictEqual(res.getResponse().count, 2);
        assert.strictEqual(res.getResponse().success, true);
        const t110 = await mockPrisma.ticket.findUnique({ where: { codigo_incidencia: 'INC-110' } });
        assert.strictEqual(t110.estado_actual, 'ASIGNADO');
        console.log(`  [Paso 3.11 - Batch assign resiliente]: OK! Asignación masiva exitosa con 2 tickets.`);
    }

    // Paso 3.12: Extracción tolerante de ticketCode mediante query params y params
    {
        await mockPrisma.ticket.create({
            data: { codigo_incidencia: 'INC-112', asunto: 'Test Query Params', area_designada: 'GENERAL', estado_actual: 'NUEVO' }
        });

        // Asignar vía query param
        const { req: assignQReq, res: assignQRes } = createMockHttp({
            query: { ticketCode: 'inc-112' },
            body: { operatorId: 'op-gen', prioridad: 'P3' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.assignTicket(assignQReq, assignQRes);
        assert.strictEqual(assignQRes.getStatusCode(), 200);
        assert.strictEqual(assignQRes.getResponse().ticket.estado_actual, 'ASIGNADO');

        // Claim vía query param
        const { req: claimQReq, res: claimQRes } = createMockHttp({
            query: { ticketCode: 'inc-112' },
            user: { id: 'op-gen', rol: 'OPERADOR', area_designada: 'GENERAL' }
        });
        await ticketController.claimTicket(claimQReq, claimQRes);
        assert.strictEqual(claimQRes.getStatusCode(), 200);
        assert.strictEqual(claimQRes.getResponse().ticket.estado_actual, 'EN_PROGRESO');

        // Unassign vía query param (debe revertir a NUEVO)
        const { req: unassignQReq, res: unassignQRes } = createMockHttp({
            query: { ticketCode: 'inc-112' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.unassignTicket(unassignQReq, unassignQRes);
        assert.strictEqual(unassignQRes.getStatusCode(), 200);
        assert.strictEqual(unassignQRes.getResponse().ticket.estado_actual, 'NUEVO');
        assert.strictEqual(unassignQRes.getResponse().ticket.asignado_a_id, null);
        console.log(`  [Paso 3.12 - Query params y normalización]: OK! Asignar, tomar y desasignar validados vía query.`);
    }

    // Paso 3.13: Desasignación idempotente de ticket ya en estado NUEVO
    {
        const { req, res } = createMockHttp({
            body: { ticketCode: 'INC-112' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.unassignTicket(req, res);
        assert.strictEqual(res.getStatusCode(), 200, 'Desasignar ticket que ya es NUEVO debe responder 200');
        assert.strictEqual(res.getResponse().ticket.estado_actual, 'NUEVO');
        console.log(`  [Paso 3.13 - Desasignación idempotente]: OK! Ticket ya en NUEVO procesado sin errores.`);
    }

    // Paso 3.14: Control de acceso para operaciones de operador ajeno
    {
        // Asignar INC-112 a op-1 y tomar
        await mockPrisma.ticket.updateMany({
            where: { codigo_incidencia: 'INC-112' },
            data: { estado_actual: 'EN_PROGRESO', asignado_a_id: 'op-1' }
        });

        // Operador op-wan intenta pausar ticket de op-1
        const { req: pauseReq, res: pauseRes } = createMockHttp({
            params: { ticketCode: 'INC-112' },
            body: { status: 'EN_PAUSA' },
            user: { id: 'op-wan', rol: 'OPERADOR', area_designada: 'WAN' }
        });
        await ticketController.updateOperatorStatus(pauseReq, pauseRes);
        assert.strictEqual(pauseRes.getStatusCode(), 403, 'Operador ajeno debe recibir 403 al intentar cambiar estado');
        console.log(`  [Paso 3.14 - Seguridad de operador]: OK! Retornó 403 (${pauseRes.getResponse().error}).`);
    }

    // Paso 3.15: Uso de campo 'action' en body o query
    {
        const { req: actionReq, res: actionRes } = createMockHttp({
            params: { ticketCode: 'INC-112' },
            body: { action: 'pause' },
            user: { id: 'op-1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' }
        });
        await ticketController.updateOperatorStatus(actionReq, actionRes);
        assert.strictEqual(actionRes.getStatusCode(), 200);
        assert.strictEqual(actionRes.getResponse().ticket.estado_actual, 'EN_PAUSA');

        const { req: resolveReq, res: resolveRes } = createMockHttp({
            params: { ticketCode: 'INC-112' },
            body: { action: 'resolve' },
            user: { id: 'op-1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' }
        });
        await ticketController.updateOperatorStatus(resolveReq, resolveRes);
        assert.strictEqual(resolveRes.getStatusCode(), 200);
        assert.strictEqual(resolveRes.getResponse().ticket.estado_actual, 'RESUELTO');

        // Coordinador confirma cierre
        const { req: confReq112, res: confRes112 } = createMockHttp({
            params: { ticketCode: 'INC-112' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.confirmCloseTicket(confReq112, confRes112);
        assert.strictEqual(confRes112.getStatusCode(), 200);
        assert.strictEqual(confRes112.getResponse().ticket.estado_actual, 'CERRADO');
        console.log(`  [Paso 3.15 - Soporte body.action y confirmClose]: OK! Transiciones pause -> resolve (RESUELTO) -> confirm-close (CERRADO) ejecutadas.`);
    }

    // Paso 3.16: Creación de ticket con 3 archivos adjuntos simultáneos
    {
        const { req, res } = createMockHttp({
            body: {
                asunto: 'Incidencia con 3 adjuntos',
                descripcion: 'Reporte con evidencias fotográficas y trazas',
                areaDesignada: 'WAN',
                origenIngesta: 'COORDINADOR',
                prioridad: 'P2'
            },
            files: [
                { originalname: 'foto1.jpg', filename: '1700000000010-foto1.jpg', path: 'public/uploads/1700000000010-foto1.jpg', mimetype: 'image/jpeg', size: 102400 },
                { originalname: 'foto2.jpg', filename: '1700000000011-foto2.jpg', path: 'public/uploads/1700000000011-foto2.jpg', mimetype: 'image/jpeg', size: 104857 },
                { originalname: 'traza.log', filename: '1700000000012-traza.log', path: 'public/uploads/1700000000012-traza.log', mimetype: 'text/plain', size: 5120 }
            ],
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(req, res);
        assert.strictEqual(res.getStatusCode(), 201, 'Debe crear ticket con 3 adjuntos (201)');
        const ticket3Adj = res.getResponse().ticket;
        assert.ok(ticket3Adj.adjuntos, 'Debe incluir propiedad adjuntos');
        assert.strictEqual(ticket3Adj.adjuntos.length, 3, 'Debe tener exactamente 3 adjuntos');
        assert.strictEqual(ticket3Adj.adjuntos[0].nombre_original, 'foto1.jpg');
        assert.strictEqual(ticket3Adj.adjuntos[1].nombre_original, 'foto2.jpg');
        assert.strictEqual(ticket3Adj.adjuntos[2].nombre_original, 'traza.log');
        console.log(`  [Paso 3.16 - Creación con 3 adjuntos]: OK! Creado ${ticket3Adj.codigo_incidencia} con 3 archivos adjuntos.`);
    }

    // Paso 3.17: Creación de ticket con 0 adjuntos -> sin error, adjuntos vacío
    {
        const { req, res } = createMockHttp({
            body: {
                asunto: 'Ticket sin adjuntos',
                descripcion: 'Sin archivos',
                areaDesignada: 'GENERAL',
                origenIngesta: 'COORDINADOR',
                prioridad: 'P3'
            },
            files: [],
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(req, res);
        assert.strictEqual(res.getStatusCode(), 201, 'Debe crear ticket sin adjuntos con 201');
        const ticketNoAdj = res.getResponse().ticket;
        assert.strictEqual(Array.isArray(ticketNoAdj.adjuntos) ? ticketNoAdj.adjuntos.length : 0, 0, 'No debe tener adjuntos');
        console.log(`  [Paso 3.17 - Creación con 0 adjuntos]: OK! Creado ${ticketNoAdj.codigo_incidencia} sin adjuntos.`);
    }

    // Paso 3.18: Bloqueo de reasignación y desasignación en estado RESUELTO
    {
        // Crear y mover ticket a RESUELTO
        const { req: cReq, res: cRes } = createMockHttp({
            body: { asunto: 'Ticket para probar bloqueos en RESUELTO', areaDesignada: 'REDES_FTTH', origenIngesta: 'COORDINADOR', prioridad: 'P1' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(cReq, cRes);
        const tCode = cRes.getResponse().ticket.codigo_incidencia;

        // Asignar a op-1 y tomar
        await mockPrisma.ticket.updateMany({
            where: { codigo_incidencia: tCode },
            data: { estado_actual: 'EN_PROGRESO', asignado_a_id: 'op-1' }
        });

        // Resolver
        const { req: rReq, res: rRes } = createMockHttp({
            params: { ticketCode: tCode },
            body: { status: 'RESUELTO' },
            user: { id: 'op-1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' }
        });
        await ticketController.updateOperatorStatus(rReq, rRes);
        assert.strictEqual(rRes.getStatusCode(), 200);
        assert.strictEqual(rRes.getResponse().ticket.estado_actual, 'RESUELTO');

        // Intento 1: Coordinador intenta reasignar ticket en RESUELTO -> debe fallar con 409
        const { req: reassignReq, res: reassignRes } = createMockHttp({
            body: { ticketCode: tCode, operatorId: 'op-gen', prioridad: 'P2' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.assignTicket(reassignReq, reassignRes);
        assert.strictEqual(reassignRes.getStatusCode(), 409, 'Reasignar ticket en RESUELTO debe retornar 409 Conflict');

        // Intento 2: Coordinador intenta desasignar ticket en RESUELTO -> debe fallar con 409
        const { req: unassignReq, res: unassignRes } = createMockHttp({
            body: { ticketCode: tCode },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.unassignTicket(unassignReq, unassignRes);
        assert.strictEqual(unassignRes.getStatusCode(), 409, 'Desasignar ticket en RESUELTO debe retornar 409 Conflict');
        console.log(`  [Paso 3.18 - Bloqueo de reasignar/desasignar en RESUELTO]: OK! Retornó 409 en ambos intentos.`);
    }

    // Paso 3.19: Coordinador intenta confirmar cierre en ticket que NO está RESUELTO
    {
        // Crear ticket NUEVO
        const { req: cReq, res: cRes } = createMockHttp({
            body: { asunto: 'Ticket nuevo para test de confirm-close inválido', areaDesignada: 'GENERAL', origenIngesta: 'COORDINADOR', prioridad: 'P3' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(cReq, cRes);
        const tNuevoCode = cRes.getResponse().ticket.codigo_incidencia;

        const { req: confReq, res: confRes } = createMockHttp({
            params: { ticketCode: tNuevoCode },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.confirmCloseTicket(confReq, confRes);
        assert.strictEqual(confRes.getStatusCode(), 409, 'Confirmar cierre en ticket NUEVO debe retornar 409');
        assert.strictEqual(confRes.getResponse().error, 'Solo se pueden confirmar tickets en estado RESUELTO');
        console.log(`  [Paso 3.19 - Validación de estado para confirmClose]: OK! Retornó 409 para ticket no resuelto.`);
    }

    // Paso 3.20: Coordinador intenta confirmar cierre en ticket ya CERRADO
    {
        const { req: confReqClosed, res: confResClosed } = createMockHttp({
            params: { ticketCode: 'INC-101' }, // INC-101 ya fue cerrado en Flujo 1
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.confirmCloseTicket(confReqClosed, confResClosed);
        assert.strictEqual(confResClosed.getStatusCode(), 409, 'Confirmar cierre en ticket ya CERRADO debe retornar 409');
        console.log(`  [Paso 3.20 - Validación ticket ya cerrado]: OK! Retornó 409 para ticket ya cerrado.`);
    }

    // Paso 3.21: Coordinador confirma cierre enviando ticketCode en el body (ruta /confirm-close)
    {
        // Crear y resolver ticket
        const { req: cReq, res: cRes } = createMockHttp({
            body: { asunto: 'Ticket para confirmClose vía body', areaDesignada: 'WAN', origenIngesta: 'COORDINADOR', prioridad: 'P1' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(cReq, cRes);
        const tCodeBody = cRes.getResponse().ticket.codigo_incidencia;

        await mockPrisma.ticket.updateMany({
            where: { codigo_incidencia: tCodeBody },
            data: { estado_actual: 'RESUELTO', asignado_a_id: 'op-wan', resueltoEn: new Date() }
        });

        // Confirmar cierre vía body.ticketCode
        const { req: confBodyReq, res: confBodyRes } = createMockHttp({
            body: { ticketCode: tCodeBody },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.confirmCloseTicket(confBodyReq, confBodyRes);
        assert.strictEqual(confBodyRes.getStatusCode(), 200, 'Confirmar cierre vía body debe retornar 200');
        assert.strictEqual(confBodyRes.getResponse().ticket.estado_actual, 'CERRADO');
        console.log(`  [Paso 3.21 - confirmClose vía body.ticketCode]: OK! Ticket ${tCodeBody} cerrado correctamente.`);
    }

    // Paso 3.22: Operador resuelve ticket directamente desde ASIGNADO
    {
        const { req: cReq, res: cRes } = createMockHttp({
            body: { asunto: 'Ticket para resolver directo desde ASIGNADO', areaDesignada: 'REDES_FTTH', origenIngesta: 'COORDINADOR', prioridad: 'P2' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(cReq, cRes);
        const tDirectCode = cRes.getResponse().ticket.codigo_incidencia;

        // Asignar a op-1
        await mockPrisma.ticket.updateMany({
            where: { codigo_incidencia: tDirectCode },
            data: { estado_actual: 'ASIGNADO', asignado_a_id: 'op-1', fecha_asignacion: new Date() }
        });

        // Operador resuelve directamente desde ASIGNADO
        const { req: rDirectReq, res: rDirectRes } = createMockHttp({
            params: { ticketCode: tDirectCode },
            body: { status: 'RESUELTO' },
            user: { id: 'op-1', rol: 'OPERADOR', area_designada: 'REDES_FTTH' }
        });
        await ticketController.updateOperatorStatus(rDirectReq, rDirectRes);
        assert.strictEqual(rDirectRes.getStatusCode(), 200, 'Operador debe poder resolver desde ASIGNADO');
        assert.strictEqual(rDirectRes.getResponse().ticket.estado_actual, 'RESUELTO');
        console.log(`  [Paso 3.22 - Resolver directo desde ASIGNADO]: OK! Ticket ${tDirectCode} pasó de ASIGNADO a RESUELTO.`);
    }

    // Paso 3.23: Operador reanuda y resuelve ticket desde EN_ESPERA_TERCEROS -> RESUELTO -> Coordinador confirma con body.codigo_incidencia
    {
        const { req: cReq, res: cRes } = createMockHttp({
            body: { asunto: 'Ticket en espera externa', areaDesignada: 'GENERAL', origenIngesta: 'COORDINADOR', prioridad: 'P3' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(cReq, cRes);
        const tWaitCode = cRes.getResponse().ticket.codigo_incidencia;

        // Asignar y poner en espera externa
        await mockPrisma.ticket.updateMany({
            where: { codigo_incidencia: tWaitCode },
            data: { estado_actual: 'EN_ESPERA_TERCEROS', asignado_a_id: 'op-gen', fecha_asignacion: new Date() }
        });

        // Operador resuelve directamente desde EN_ESPERA_TERCEROS
        const { req: rWaitReq, res: rWaitRes } = createMockHttp({
            params: { ticketCode: tWaitCode },
            body: { status: 'RESUELTO' },
            user: { id: 'op-gen', rol: 'OPERADOR', area_designada: 'GENERAL' }
        });
        await ticketController.updateOperatorStatus(rWaitReq, rWaitRes);
        assert.strictEqual(rWaitRes.getStatusCode(), 200, 'Operador debe poder resolver desde EN_ESPERA_TERCEROS');
        assert.strictEqual(rWaitRes.getResponse().ticket.estado_actual, 'RESUELTO');

        // Coordinador confirma cierre enviando { codigo_incidencia: tWaitCode }
        const { req: confReq, res: confRes } = createMockHttp({
            body: { codigo_incidencia: tWaitCode },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.confirmCloseTicket(confReq, confRes);
        assert.strictEqual(confRes.getStatusCode(), 200, 'Confirmar cierre con body.codigo_incidencia debe retornar 200');
        assert.strictEqual(confRes.getResponse().ticket.estado_actual, 'CERRADO');
        console.log(`  [Paso 3.23 - Resolver desde EN_ESPERA_TERCEROS y confirmClose con codigo_incidencia]: OK! Ticket ${tWaitCode} resuelto y cerrado.`);
    }

    // Paso 3.24: Coordinador confirma cierre enviando { ticketCodes: ['...'] }
    {
        const { req: cReq, res: cRes } = createMockHttp({
            body: { asunto: 'Ticket para confirmClose vía array ticketCodes', areaDesignada: 'WAN', origenIngesta: 'COORDINADOR', prioridad: 'P1' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.createTicket(cReq, cRes);
        const tArrayCode = cRes.getResponse().ticket.codigo_incidencia;

        await mockPrisma.ticket.updateMany({
            where: { codigo_incidencia: tArrayCode },
            data: { estado_actual: 'RESUELTO', asignado_a_id: 'op-wan', resueltoEn: new Date() }
        });

        const { req: confArrReq, res: confArrRes } = createMockHttp({
            body: { ticketCodes: [tArrayCode] },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.confirmCloseTicket(confArrReq, confArrRes);
        assert.strictEqual(confArrRes.getStatusCode(), 200, 'Confirmar cierre con body.ticketCodes array debe retornar 200');
        assert.strictEqual(confArrRes.getResponse().ticket.estado_actual, 'CERRADO');
        console.log(`  [Paso 3.24 - confirmClose vía body.ticketCodes array]: OK! Ticket ${tArrayCode} cerrado correctamente.`);
    }

    // Paso 3.25: Consulta de ticket existente y adjuntos vía getTicketByCode
    {
        const { req, res } = createMockHttp({
            params: { ticketCode: 'INC-101' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.getTicketByCode(req, res);
        assert.strictEqual(res.getStatusCode(), 200, 'getTicketByCode debe retornar 200');
        const data = res.getResponse();
        assert.ok(data.ticket, 'Debe incluir ticket');
        assert.strictEqual(data.ticket.codigo_incidencia, 'INC-101');
        assert.ok(Array.isArray(data.ticket.adjuntos), 'Debe incluir array de adjuntos');
        console.log('  [Paso 3.25 - getTicketByCode ticket existente]: OK! Retorna ticket y array adjuntos.');
    }

    // Paso 3.26: Consulta de ticket inexistente vía getTicketByCode
    {
        const { req, res } = createMockHttp({
            params: { ticketCode: 'INC-9999' },
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.getTicketByCode(req, res);
        assert.strictEqual(res.getStatusCode(), 404, 'getTicketByCode debe retornar 404 para ticket no existente');
        console.log('  [Paso 3.26 - getTicketByCode ticket inexistente]: OK! Retorna 404.');
    }

    // Paso 3.27: Consulta sin ticketCode vía getTicketByCode
    {
        const { req, res } = createMockHttp({
            params: {},
            user: { id: 'coord-1', rol: 'COORDINADOR' }
        });
        await ticketController.getTicketByCode(req, res);
        assert.strictEqual(res.getStatusCode(), 400, 'getTicketByCode debe retornar 400 sin código');
        console.log('  [Paso 3.27 - getTicketByCode sin código]: OK! Retorna 400.');
    }

    console.log('>>> FLUJO 3 COMPLETADO EXITOSAMENTE\n');

    console.log('========================================================');
    console.log(' TODAS LAS SIMULACIONES PASARON CON ÉXITO (3/3)');
    console.log('========================================================');

    return {
        flujo1: 'PASSED',
        flujo2: 'PASSED',
        flujo3: 'PASSED'
    };
}

if (require.main === module) {
    runSimulations().catch(err => {
        console.error('ERROR EN SIMULACIÓN:', err);
        process.exit(1);
    });
}

module.exports = { runSimulations, createMockPrisma, createMockHttp };
