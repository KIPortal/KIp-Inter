'use strict';

/**
 * Auditoría (IMPLEMENTACION.md §3.5): catálogo de acciones, filtros y registro
 * agrupado por día de Caracas. Funciones puras (ver scripts/test-audit.js).
 */

const { getDayBounds, formatCaracasDate, UTC_OFFSET_HOURS } = require('./metricsService');

const DAY_MS = 24 * 3600 * 1000;

// Código guardado → [etiqueta corta, tono]
const ACCIONES = Object.freeze({
    TICKET_CERRADO: ['Cerró', 'gris'],
    TICKET_RESUELTO: ['Resolvió', 'verde'],
    TICKET_ASIGNADO: ['Asignó', 'azul'],
    TICKET_REASIGNADO: ['Reasignó', 'azul'],
    TICKET_DESASIGNADO: ['Desasignó', 'ambar'],
    TICKET_TOMADO: ['Tomó', 'azul'],
    TICKET_PAUSADO: ['Pausó', 'ambar'],
    TICKET_REANUDADO: ['Reanudó', 'azul'],
    TICKET_EN_ESPERA: ['Dejó en espera', 'violeta'],
    TICKET_EDITADO: ['Editó', 'azul'],
    TICKET_ELIMINADO: ['Eliminó', 'rojo'],
    TICKET_RESTAURADO: ['Restauró', 'verde'],
    TICKET_TRASPASADO_GUARDIA: ['Traspasó', 'violeta'],
    TRASPASO_ATENDIDO: ['Traspaso atendido', 'violeta'],
    GUARDIA_DEFINIDA: ['Guardia', 'violeta'],
    HORARIO_EDITADO: ['Horario', 'azul'],
    CONFIGURACION_EDITADA: ['Configuración', 'gris'],
    USUARIO_CREADO: ['Creó usuario', 'verde'],
    USUARIO_EDITADO: ['Editó usuario', 'azul'],
    AREA_CREADA: ['Creó área', 'verde'],
    AREA_EDITADA: ['Editó área', 'azul']
});

const FECHAS = Object.freeze([
    ['hoy', 'Hoy'], ['ayer', 'Ayer'], ['7d', 'Últimos 7 días'], ['30d', 'Últimos 30 días'], ['todo', 'Todo']
]);

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function actionInfo(codigo) {
    const a = ACCIONES[codigo];
    if (a) return { codigo, etiqueta: a[0], tono: a[1] };
    // Códigos antiguos o nuevos sin traducir: "ALGO_HECHO" → "Algo hecho"
    const texto = String(codigo || 'Acción').toLowerCase().replace(/_/g, ' ');
    return { codigo, etiqueta: texto.charAt(0).toUpperCase() + texto.slice(1), tono: 'gris' };
}

/** Filtros válidos a partir de la consulta. */
function parseAuditQuery(query = {}) {
    const str = v => (typeof v === 'string' ? v.trim() : '');
    const fecha = FECHAS.some(f => f[0] === str(query.fecha)) ? str(query.fecha) : '7d';
    const limite = Math.min(1000, Math.max(50, Number.parseInt(query.limite, 10) || 200));
    return { usuario: str(query.usuario), accion: str(query.accion), fecha, q: str(query.q).slice(0, 80), limite };
}

/** Desde cuándo pedir registros para un filtro de fecha (Caracas). */
function dateRange(fecha, now = new Date()) {
    const hoy = getDayBounds(now).start;
    if (fecha === 'hoy') return { gte: hoy };
    if (fecha === 'ayer') return { gte: new Date(hoy.getTime() - DAY_MS), lt: hoy };
    if (fecha === '7d') return { gte: new Date(hoy.getTime() - 6 * DAY_MS) };
    if (fecha === '30d') return { gte: new Date(hoy.getTime() - 29 * DAY_MS) };
    return null;
}

/** "Hoy, martes 13 oct" / "Ayer, lunes 12 oct" / "Domingo 11 oct". */
function dayLabel(iso, now = new Date()) {
    const hoy = formatCaracasDate(now);
    const ayer = formatCaracasDate(new Date(new Date(now).getTime() - DAY_MS));
    const [y, m, d] = iso.split('-').map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const base = `${DIAS[dow]} ${d} ${MESES[m - 1]}`;
    if (iso === hoy) return `Hoy, ${base}`;
    if (iso === ayer) return `Ayer, ${base}`;
    return base.charAt(0).toUpperCase() + base.slice(1);
}

function initials(nombre) {
    return String(nombre || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

/**
 * @param {Array} logs  [{ accion, detalles, createdAt, user: { nombre, email, rol } | null, ticket: { codigo_incidencia } | null }]
 */
function buildAuditView({ logs = [], hoyLogs = [], usuarios = [], filtros = parseAuditQuery(), now = new Date(), hayMas = false } = {}) {
    const q = filtros.q.toLowerCase();
    const filas = logs
        .map(l => {
            const usuario = l.user ? (l.user.nombre || l.user.email) : 'Sistema';
            const info = actionInfo(l.accion);
            return {
                dia: formatCaracasDate(l.createdAt),
                hora: new Date(new Date(l.createdAt).getTime() + UTC_OFFSET_HOURS * 3600 * 1000).toISOString().slice(11, 16),
                usuario,
                iniciales: l.user ? initials(usuario) : 'S',
                sistema: !l.user,
                accion: info,
                ticket: l.ticket?.codigo_incidencia || '',
                detalle: l.detalles || ''
            };
        })
        .filter(f => !q || `${f.ticket} ${f.usuario} ${f.detalle} ${f.accion.etiqueta}`.toLowerCase().includes(q));

    const dias = [];
    filas.forEach(f => {
        let d = dias[dias.length - 1];
        if (!d || d.fecha !== f.dia) { d = { fecha: f.dia, etiqueta: dayLabel(f.dia, now), filas: [] }; dias.push(d); }
        d.filas.push(f);
    });

    const resumen = {
        eventosHoy: hoyLogs.length,
        usuariosHoy: new Set(hoyLogs.filter(l => l.userId).map(l => l.userId)).size,
        reasignacionesHoy: hoyLogs.filter(l => l.accion === 'TICKET_REASIGNADO').length,
        eliminacionesHoy: hoyLogs.filter(l => l.accion === 'TICKET_ELIMINADO').length
    };

    return {
        filtros,
        resumen,
        dias,
        total: filas.length,
        hayMas,
        opciones: {
            usuarios: usuarios.map(u => ({ id: u.id, nombre: u.nombre || u.email })),
            acciones: Object.keys(ACCIONES).map(codigo => ({ codigo, etiqueta: ACCIONES[codigo][0] })),
            fechas: FECHAS.map(([valor, etiqueta]) => ({ valor, etiqueta }))
        }
    };
}

/** CSV del registro (separador ; para Excel en español). */
function toCsv(view) {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lineas = [['Fecha', 'Hora', 'Usuario', 'Acción', 'Ticket', 'Detalle'].map(esc).join(';')];
    view.dias.forEach(d => d.filas.forEach(f => lineas.push([d.fecha, f.hora, f.usuario, f.accion.etiqueta, f.ticket, f.detalle].map(esc).join(';'))));
    return '﻿' + lineas.join('\r\n');
}

// Id para AuditLog.userId: el usuario temporal del acceso de desarrollo no existe en User (la FK lo rechaza)
const auditUserId = req => (req.user?.id && !String(req.user.id).startsWith('temporary:') ? req.user.id : null);

module.exports = { ACCIONES, FECHAS, actionInfo, parseAuditQuery, dateRange, dayLabel, buildAuditView, toCsv, auditUserId };
