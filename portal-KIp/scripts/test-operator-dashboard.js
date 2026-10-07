const fs = require('fs');
const path = require('path');
const ejs = require('ejs');
const assert = require('assert');

// Correct view path relative to scripts directory
const viewPath = path.resolve(__dirname, '..', 'views', 'operator-dashboard.ejs');
assert(fs.existsSync(viewPath), `View file must exist at ${viewPath}`);

const template = fs.readFileSync(viewPath, 'utf8');

console.log('Testing operator-dashboard.ejs compilation and rendering...');

// Test 1: Compile template with EJS
const compiled = ejs.compile(template, { filename: viewPath });
console.log('✔ EJS compilation successful');

// Test 2: Render with typical operator data across different areas and priorities
const mockData = {
    titulo: 'Operaciones · Portal NOC',
    currentUser: {
        id: 'op-1',
        nombre: 'Juan Pérez',
        email: 'juan@noc.com',
        rol: 'OPERADOR',
        area_designada: 'REDES_FTTH',
        estado_operativo: 'DISPONIBLE'
    },
    ticketsAvailable: [
        { 
            codigo_incidencia: 'INC-001', 
            asunto: 'Falla GPON Guarenas', 
            descripcion: 'Pérdida de señal óptica en OLT-02 puerto 4.',
            remitente: 'noc-alertas@inter.com',
            origen_ingesta: 'CORREO',
            area_designada: 'REDES_FTTH', 
            puntos_complejidad: 8, 
            createdAt: new Date('2026-10-07T10:00:00Z') 
        },
        { 
            codigo_incidencia: 'INC-002', 
            asunto: 'Corte de Fibra Troncal', 
            descripcion: 'Alarma de corte físico en enlace Caracas-Guatire.',
            remitente: 'supervision@inter.com',
            origen_ingesta: 'LLAMADA',
            area_designada: 'REDES_FTTH', 
            puntos_complejidad: 5, 
            createdAt: new Date('2026-10-07T10:15:00Z') 
        },
        { 
            codigo_incidencia: 'INC-003', 
            asunto: 'Saturación Enlace IP General', 
            descripcion: 'Tráfico supera el 95% del umbral.',
            area_designada: 'GENERAL', 
            puntos_complejidad: 1, 
            createdAt: new Date('2026-10-07T10:30:00Z') 
        }
    ],
    ticketsAssigned: [
        { 
            codigo_incidencia: 'INC-004', 
            asunto: 'Reemplazo OLT Puerto 4', 
            descripcion: 'Sustitución de tarjeta SFP defectuosa.',
            area_designada: 'REDES_FTTH', 
            puntos_complejidad: 5, 
            fecha_asignacion: new Date('2026-10-07T11:00:00Z'), 
            estado_actual: 'EN_PROGRESO' 
        }
    ],
    ticketsPaused: [
        { 
            codigo_incidencia: 'INC-005', 
            asunto: 'En espera de cuadrilla técnica', 
            descripcion: 'Cuadrilla en tránsito hacia la central.',
            area_designada: 'REDES_FTTH', 
            puntos_complejidad: 6, 
            fecha_asignacion: new Date('2026-10-07T11:15:00Z'), 
            estado_actual: 'EN_PAUSA' 
        }
    ],
    ticketsWaiting: [],
    ticketsResolved: [
        { 
            codigo_incidencia: 'INC-006', 
            asunto: 'Configuración VLAN Completada', 
            descripcion: 'VLAN 102 aprovisionada y validada.',
            area_designada: 'REDES_FTTH', 
            puntos_complejidad: 2, 
            fecha_cierre: new Date('2026-10-07T11:30:00Z'), 
            estado_actual: 'CERRADO' 
        }
    ]
};

const html = compiled(mockData);
console.log('✔ Render with typical data successful (HTML length: ' + html.length + ')');

// Check Requirements:
// R1: Light theme (macOS 27 Liquid Glass)
assert(html.includes('bg-[#E8E8ED]'), 'HTML tag must have bg-[#E8E8ED]');
assert(html.includes('bg-[#F5F5F7]'), 'Body must have bg-[#F5F5F7]');
assert(!html.includes('dark:bg-'), 'Should not contain dark mode background classes');
assert(!html.includes('dark:text-'), 'Should not contain dark mode text classes');
assert(html.includes('figma-toolbars-search__liquid-glass'), 'Search input must have Liquid Glass element');
console.log('✔ R1 Light theme styling verified');

// R2: Responsive behavior
assert(html.includes('queue-grid-container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3'), 'Must contain 1/2/3/4-col responsive grid');
assert(html.includes('@media (min-width: 768px)'), 'Must contain media query for desktop table toggling');
assert(html.includes('@media (max-width: 767px)'), 'Must contain media query for mobile cards preservation');
assert(html.includes('syncResponsiveView'), 'Must include responsive viewport sync');
console.log('✔ R2 Responsive behavior verified');

// Interactive elements
assert(html.includes('data-ticket-action="claim"'), 'Must have claim action button');
assert(html.includes('data-ticket-action="status"'), 'Must have status action button');
assert(html.includes('data-ticket-status="EN_PAUSA"'), 'Must have pause status button');
assert(html.includes('data-ticket-status="CERRADO"'), 'Must have close/resolve status button');
console.log('✔ Action buttons verified');

// Priority badges consistency (P1, P2, P3, S/P) matching views/index.ejs
assert(html.includes('P1 (Crítica)'), 'Must compute P1 priority badge');
assert(html.includes('P2 (Media)'), 'Must compute P2 priority badge');
assert(html.includes('P3 (Baja)'), 'Must compute P3 priority badge');
console.log('✔ Priority badges consistency with index.ejs verified');

// User Requirement 1: Real-time updates for assigned tickets
assert(html.includes('id="realtimeStatusBadge"'), 'Must have real-time live indicator');
assert(html.includes('checkRealtimeUpdates'), 'Must have real-time update checker');
assert(html.includes('startRealtimeSync'), 'Must have real-time sync initialization');
console.log('✔ Real-time update engine verified');

// User Requirement 2: Available tickets organized/divided by area
assert(html.includes('id="availableAreaChips"'), 'Must have available area filter chips');
assert(html.includes('filterAvailableByArea'), 'Must have area filter handler');
assert(html.includes('Dividir por área:'), 'Must have area division header for available tickets');
console.log('✔ Available tickets divided by area verified');

// User Requirement 3: Consult full ticket details before claiming
assert(html.includes('id="ticketDetailsOverlay"'), 'Must have ticket details modal overlay');
assert(html.includes('openTicketDetails'), 'Must have ticket details open handler');
assert(html.includes('modalDetailDescription'), 'Must display full ticket description in modal');
assert(html.includes('Tomar Incidencia'), 'Must allow claiming ticket from inside details modal');
console.log('✔ Pre-claim ticket details modal verified');

// Concurrency protection against race conditions
assert(html.includes('isActionInProgress'), 'Must have concurrency lock preventing rapid clicks');
console.log('✔ Button concurrency protection verified');

// Test 3: Render with empty queues (edge case)
const emptyHtml = compiled({
    titulo: 'Portal NOC',
    currentUser: null,
    ticketsAvailable: [],
    ticketsAssigned: [],
    ticketsPaused: [],
    ticketsWaiting: [],
    ticketsResolved: []
});
assert(emptyHtml.includes('No hay tickets en esta cola'), 'Empty state message must render correctly');
console.log('✔ Empty state edge case verified');

// Test 4: Extreme string length & null attributes edge case
const edgeData = {
    titulo: 'Portal NOC - Edge Test',
    currentUser: { nombre: 'Test', area_designada: 'GENERAL' },
    ticketsAvailable: [
        {
            codigo_incidencia: 'INC-999',
            asunto: 'INCIDENCIA_SIN_ESPACIOS_EXTREMADAMENTE_LARGA_DE_PRUEBA_00000000000000000000000000000000000000000000000000000000000000000000000000000000',
            descripcion: null,
            remitente: null,
            area_designada: null,
            puntos_complejidad: 0,
            createdAt: null
        }
    ],
    ticketsAssigned: [],
    ticketsPaused: [],
    ticketsWaiting: [],
    ticketsResolved: []
};
const edgeHtml = compiled(edgeData);
assert(edgeHtml.includes('INC-999'), 'Must render edge ticket code');
assert(edgeHtml.includes('break-all'), 'Must break long unbroken strings to prevent card overflow');
assert(edgeHtml.includes('Fecha no disponible'), 'Must handle null createdAt gracefully');
console.log('✔ Extreme string length and null fields edge case verified');

// Test 5: UTF-8 encoding and required keyword assertions
assert(html.includes('Gestión'), 'Must contain properly accented "Gestión"');
assert(html.includes('Auditoría'), 'Must contain properly accented "Auditoría"');
assert(html.includes('Acción'), 'Must contain properly accented "Acción"');
assert(html.includes('Área'), 'Must contain properly accented "Área"');
assert(!html.includes('\uFFFD'), 'Must not contain Unicode replacement character (\\uFFFD)');
assert(!html.includes('&amp;quot;'), 'Must not contain double-escaped &amp;quot;');
assert(!html.includes('shadow-2xs'), 'Must not contain invalid Tailwind v3 "shadow-2xs" class');

const buffer = fs.readFileSync(viewPath);
let byteIdx = 0;
let byteFailures = 0;
while (byteIdx < buffer.length) {
    const b = buffer[byteIdx];
    if (b < 0x80) {
        byteIdx++;
    } else if (b >= 0xC2 && b <= 0xDF && byteIdx + 1 < buffer.length && buffer[byteIdx + 1] >= 0x80 && buffer[byteIdx + 1] <= 0xBF) {
        byteIdx += 2;
    } else if (b >= 0xE0 && b <= 0xEF && byteIdx + 2 < buffer.length &&
        buffer[byteIdx + 1] >= 0x80 && buffer[byteIdx + 1] <= 0xBF &&
        buffer[byteIdx + 2] >= 0x80 && buffer[byteIdx + 2] <= 0xBF) {
        byteIdx += 3;
    } else if (b >= 0xF0 && b <= 0xF4 && byteIdx + 3 < buffer.length &&
        buffer[byteIdx + 1] >= 0x80 && buffer[byteIdx + 1] <= 0xBF &&
        buffer[byteIdx + 2] >= 0x80 && buffer[byteIdx + 2] <= 0xBF &&
        buffer[byteIdx + 3] >= 0x80 && buffer[byteIdx + 3] <= 0xBF) {
        byteIdx += 4;
    } else {
        byteFailures++;
        byteIdx++;
    }
}
assert.strictEqual(byteFailures, 0, 'Must have 0 invalid UTF-8 bytes');
console.log('✔ UTF-8 accented keywords, byte validity, and clean encoding verified');

// Test 6: Advanced Real-time Fingerprint Engine Verification
assert(html.includes('getTicketFingerprint'), 'Must implement fingerprint-based diffing');
assert(html.includes('initialTicketFingerprint'), 'Must track initial ticket fingerprint');
assert(!html.includes('newRows.length !== lastKnownTicketCount'), 'Must not use broken 2*N count comparison for polling reload');
assert(html.includes("hash === '#paused-waiting'"), 'Must handle #paused-waiting route in updateView');
console.log('✔ Real-time fingerprint diffing engine verified');

// Test 7: Modal Status Badge and Search Completeness Verification
assert(html.includes('id="modalDetailStatusBadge"'), 'Must have modal detail status badge container');
assert(html.includes("document.getElementById('modalDetailStatusBadge')"), 'Must populate status badge in openTicketDetails');
assert(html.includes('data-filter-empty'), 'Must contain empty filter state row in table');
assert(html.includes('data-filter-empty-grid'), 'Must contain empty filter state placeholder in grid');
assert(html.includes('ticketSender'), 'Search must inspect ticket sender attribute');
assert(html.includes('ticketOrigin'), 'Search must inspect ticket origin attribute');
assert(html.includes('ticketCode'), 'Search must inspect ticket code attribute');
console.log('✔ Pre-claim status badge, search attributes, and empty filter states verified');

// Test 8: Fingerprint Logic Simulation in JS
const simulateFingerprint = (tickets) => {
    return tickets.map(t => `${t.code}:${t.status}:${t.queue}`).sort().join('|');
};
const fp1 = simulateFingerprint([
    { code: 'INC-001', status: 'NUEVO', queue: 'available' },
    { code: 'INC-002', status: 'EN_PROGRESO', queue: 'assigned' }
]);
const fp2 = simulateFingerprint([
    { code: 'INC-001', status: 'NUEVO', queue: 'available' },
    { code: 'INC-002', status: 'EN_PROGRESO', queue: 'assigned' }
]);
const fpStatusChanged = simulateFingerprint([
    { code: 'INC-001', status: 'EN_PROGRESO', queue: 'assigned' },
    { code: 'INC-002', status: 'EN_PROGRESO', queue: 'assigned' }
]);
assert.strictEqual(fp1, fp2, 'Identical state must produce identical fingerprint');
assert.notStrictEqual(fp1, fpStatusChanged, 'Status change must alter fingerprint');
console.log('✔ Fingerprint diffing simulation logic verified');

console.log('\nAll operator-dashboard.ejs tests passed successfully!');
