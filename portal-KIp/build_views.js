const fs = require('fs');
const path = require('path');

const basePath = path.join(__dirname, 'views');
const index = fs.readFileSync(path.join(basePath, 'index.ejs'), 'utf-8');

const headParts = index.split('<main class="flex-1 flex flex-col min-w-0 bg-white overflow-hidden p-2 sm:p-4 gap-3">');
const bottomParts = index.split('</main>');

if (headParts.length < 2 || bottomParts.length < 2) {
    console.error("Could not parse index.ejs");
    process.exit(1);
}

const headerSidebar = headParts[0];
const footer = '</main>' + bottomParts[bottomParts.length - 1];

function buildNav(activeItem) {
    // We will find the nav block and modify it manually to avoid bad regexes
    const dashActive = activeItem === 'dashboard' ? 'bg-[#007AFF] text-white' : 'text-[#3A3A3C] hover:bg-black/5';
    const dashIcon = activeItem === 'dashboard' ? 'text-white' : 'text-[#007AFF]';
    const dashBadge = activeItem === 'dashboard' ? 'bg-white/20 text-white' : 'bg-[#007AFF]/15 text-[#0062CC]';

    const auditActive = activeItem === 'audit' ? 'bg-[#007AFF] text-white' : 'text-[#3A3A3C] hover:bg-black/5';
    const auditIcon = activeItem === 'audit' ? 'text-white' : 'text-[#8E8E93]';

    const repActive = activeItem === 'report' ? 'bg-[#007AFF] text-white' : 'text-[#3A3A3C] hover:bg-black/5';
    const repIcon = activeItem === 'report' ? 'text-white' : 'text-[#8E8E93]';

    return `
                        <nav class="space-y-0.5">
                            <a id="dashboardNavLink" class="flex items-center justify-between px-2.5 py-1.5 rounded-[6px] ${dashActive} font-medium text-[12px] transition"
                                href="/">
                                <div class="flex items-center gap-2">
                                    <svg class="w-4 h-4 ${dashIcon}" fill="currentColor" viewBox="0 0 24 24">
                                        <path
                                            d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-15a3 3 0 0 0-3-3V18a3 3 0 0 0 3 3h15ZM1.5 10.5V6a3 3 0 0 1 3-3h15a3 3 0 0 1 3 3v4.5">
                                        </path>
                                    </svg>
                                    <span class="hidden md:inline">Dashboard General</span>
                                </div>
                                <span
                                    class="hidden md:inline font-mono text-[9px] ${dashBadge} px-1.5 py-0.5 rounded font-bold">
                                    <%= typeof ticketsActivos !== 'undefined' ? ticketsActivos : 0 %>
                                </span>
                            </a>
                            <a class="flex items-center justify-between px-2.5 py-1.5 rounded-[6px] ${auditActive} text-[12px] font-medium transition"
                                href="/auditoria">
                                <div class="flex items-center gap-2">
                                    <svg class="w-4 h-4 ${auditIcon}" fill="none" stroke="currentColor"
                                        stroke-width="2" viewBox="0 0 24 24">
                                        <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                    </svg>
                                    <span class="hidden md:inline">Auditoría</span>
                                </div>
                            </a>
                            <a id="shiftManagementNavLink" class="flex items-center justify-between px-2.5 py-1.5 rounded-[6px] text-[#3A3A3C] hover:bg-black/5 text-[12px] font-medium transition"
                                href="/#gestion-turno">
                                <div class="flex items-center gap-2">
                                    <svg class="w-4 h-4 text-[#8E8E93]" fill="none" stroke="currentColor"
                                        stroke-width="2" viewBox="0 0 24 24">
                                        <path
                                            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z">
                                        </path>
                                    </svg>
                                    <span class="hidden md:inline">Gestión de Turno</span>
                                </div>
                                <span
                                    class="hidden md:inline font-mono text-[9px] bg-[#34C759]/15 text-[#34C759] px-1.5 py-0.5 rounded font-bold">
                                    <%= typeof operadoresDisponibles !== 'undefined' ? operadoresDisponibles : 0 %>/<%= typeof totalOperadores !== 'undefined' ? totalOperadores : 0 %>
                                </span>
                            </a>
                            <a class="flex items-center justify-between px-2.5 py-1.5 rounded-[6px] ${repActive} text-[12px] font-medium transition"
                                href="/reportes">
                                <div class="flex items-center gap-2">
                                    <svg class="w-4 h-4 ${repIcon}" fill="none" stroke="currentColor"
                                        stroke-width="2" viewBox="0 0 24 24">
                                        <path
                                            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z">
                                        </path>
                                    </svg>
                                    <span class="hidden md:inline">Reportes</span>
                                </div>
                            </a>
                        </nav>`;
}

function getLayoutWithNav(activeItem) {
    const navRegex = /<nav class="space-y-0\.5">[\s\S]*?<\/nav>/;
    return headerSidebar.replace(navRegex, buildNav(activeItem));
}

const reportsContent = getLayoutWithNav('report') + `
            <main class="flex-1 flex flex-col min-w-0 bg-white overflow-y-auto p-4 sm:p-6 gap-6">
                <!-- KPI Cards Liquid Glass -->
                <div>
                    <h2 class="text-lg font-semibold text-[#1C1C1E] mb-4">Métricas Principales</h2>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div class="bg-white/60 backdrop-blur-xl border border-white/40 rounded-[12px] p-4 flex flex-col shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative overflow-hidden group">
                            <div class="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 group-hover:opacity-100 transition duration-500"></div>
                            <span class="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider relative z-10">Tickets Totales</span>
                            <span class="mt-2 text-[32px] font-semibold font-mono text-[#1C1C1E] num-tabular relative z-10"><%= typeof kpis !== 'undefined' && kpis.total ? kpis.total : 0 %></span>
                        </div>
                        <div class="bg-white/60 backdrop-blur-xl border border-white/40 rounded-[12px] p-4 flex flex-col shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative overflow-hidden group">
                            <div class="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 group-hover:opacity-100 transition duration-500"></div>
                            <span class="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider relative z-10">Resueltos</span>
                            <span class="mt-2 text-[32px] font-semibold font-mono text-[#1C1C1E] num-tabular relative z-10"><%= typeof kpis !== 'undefined' && kpis.resueltos ? kpis.resueltos : 0 %></span>
                        </div>
                        <div class="bg-white/60 backdrop-blur-xl border border-white/40 rounded-[12px] p-4 flex flex-col shadow-[0_8px_30px_rgba(0,0,0,0.04)] relative overflow-hidden group">
                            <div class="absolute inset-0 bg-gradient-to-br from-white/40 to-transparent opacity-0 group-hover:opacity-100 transition duration-500"></div>
                            <span class="text-[11px] font-semibold text-[#8E8E93] uppercase tracking-wider relative z-10">Tasa de Resolución</span>
                            <span class="mt-2 text-[32px] font-semibold font-mono text-[#1C1C1E] num-tabular relative z-10"><%= typeof kpis !== 'undefined' && kpis.tasa ? kpis.tasa : '0%' %></span>
                        </div>
                    </div>
                </div>

                <!-- Operator Performance -->
                <div class="flex-1 flex flex-col min-h-0 bg-white border border-[#E5E5EA] rounded-[12px] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
                    <div class="px-4 py-3 bg-[#F6F6F8] border-b border-[#E5E5EA]">
                        <h3 class="text-[13px] font-semibold text-[#1C1C1E]">Rendimiento de Operadores</h3>
                    </div>
                    <div class="flex-1 overflow-auto">
                        <table class="w-full text-left border-collapse text-[12px] figma-table">
                            <thead class="bg-white sticky top-0 z-10 border-b border-[#E5E5EA] shadow-sm">
                                <tr>
                                    <th class="py-2 px-4 font-semibold text-[#8E8E93] uppercase tracking-wider text-[10px]">Operador</th>
                                    <th class="py-2 px-4 font-semibold text-[#8E8E93] uppercase tracking-wider text-[10px]">Puntos</th>
                                    <th class="py-2 px-4 font-semibold text-[#8E8E93] uppercase tracking-wider text-[10px]">Tickets Resueltos</th>
                                    <th class="py-2 px-4 font-semibold text-[#8E8E93] uppercase tracking-wider text-[10px]">Tiempo Promedio</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-[#E5E5EA]">
                                <% if (typeof operadores !== 'undefined' && operadores.length > 0) { %>
                                    <% operadores.forEach(op => { %>
                                    <tr class="hover:bg-[#F9F9FA] transition">
                                        <td class="py-2.5 px-4 font-medium text-[#1C1C1E] flex items-center gap-2">
                                            <div class="w-6 h-6 rounded-full bg-[#007AFF] text-white flex items-center justify-center font-mono font-semibold text-[9px]">
                                                <%= op.nombre.trim().split(/\\s+/).slice(0, 2).map(p => p.charAt(0)).join('').toUpperCase() %>
                                            </div>
                                            <%= op.nombre %>
                                        </td>
                                        <td class="py-2.5 px-4 text-[#007AFF] font-mono font-semibold"><%= op.puntos || 0 %></td>
                                        <td class="py-2.5 px-4 text-[#48484A] font-mono"><%= op.resueltos || 0 %></td>
                                        <td class="py-2.5 px-4 text-[#48484A] font-mono"><%= op.tiempoPromedio || 'N/A' %></td>
                                    </tr>
                                    <% }) %>
                                <% } else { %>
                                    <tr>
                                        <td colspan="4" class="py-6 text-center text-[#8E8E93]">No hay datos de operadores.</td>
                                    </tr>
                                <% } %>
                            </tbody>
                        </table>
                    </div>
                </div>
` + footer;

const auditContent = getLayoutWithNav('audit') + `
            <main class="flex-1 flex flex-col min-w-0 bg-[#F5F5F7] overflow-hidden p-4 sm:p-6 gap-4">
                <div class="flex items-center justify-between">
                    <h2 class="text-lg font-semibold text-[#1C1C1E]">Historial de Auditoría</h2>
                </div>

                <div class="flex-1 flex flex-col min-h-0 bg-white border border-[#E5E5EA] rounded-[12px] shadow-[0_1px_4px_rgba(0,0,0,0.04)] overflow-hidden">
                    <div class="px-4 py-3 bg-[#F6F6F8] border-b border-[#E5E5EA]">
                        <h3 class="text-[13px] font-semibold text-[#1C1C1E]">Logs del Sistema</h3>
                    </div>
                    <div class="flex-1 overflow-auto">
                        <table class="w-full text-left border-collapse text-[12px] figma-table">
                            <thead class="bg-white sticky top-0 z-10 border-b border-[#E5E5EA] shadow-sm">
                                <tr>
                                    <th class="py-2 px-4 font-semibold text-[#8E8E93] uppercase tracking-wider text-[10px]">Fecha</th>
                                    <th class="py-2 px-4 font-semibold text-[#8E8E93] uppercase tracking-wider text-[10px]">Usuario</th>
                                    <th class="py-2 px-4 font-semibold text-[#8E8E93] uppercase tracking-wider text-[10px]">Acción</th>
                                    <th class="py-2 px-4 font-semibold text-[#8E8E93] uppercase tracking-wider text-[10px]">Ticket</th>
                                    <th class="py-2 px-4 font-semibold text-[#8E8E93] uppercase tracking-wider text-[10px]">Detalles</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-[#E5E5EA]">
                                <% if (typeof logs !== 'undefined' && logs.length > 0) { %>
                                    <% logs.forEach(log => { %>
                                    <tr class="hover:bg-[#F9F9FA] transition">
                                        <td class="py-2.5 px-4 text-[#48484A] font-mono whitespace-nowrap"><%= log.fecha %></td>
                                        <td class="py-2.5 px-4 font-medium text-[#1C1C1E]"><%= log.usuario %></td>
                                        <td class="py-2.5 px-4 text-[#48484A]"><span class="px-2 py-0.5 rounded-full bg-[#E5F9ED] text-[#16834A] text-[10px] font-semibold"><%= log.accion %></span></td>
                                        <td class="py-2.5 px-4 text-[#007AFF] font-mono cursor-pointer hover:underline"><%= log.ticket || '-' %></td>
                                        <td class="py-2.5 px-4 text-[#8E8E93] truncate max-w-xs" title="<%= log.detalles %>"><%= log.detalles %></td>
                                    </tr>
                                    <% }) %>
                                <% } else { %>
                                    <tr>
                                        <td colspan="5" class="py-6 text-center text-[#8E8E93]">No se encontraron registros de auditoría.</td>
                                    </tr>
                                <% } %>
                            </tbody>
                        </table>
                    </div>
                </div>
` + footer;

fs.writeFileSync(path.join(basePath, 'reports.ejs'), reportsContent);
fs.writeFileSync(path.join(basePath, 'audit.ejs'), auditContent);

console.log("Files written successfully");
