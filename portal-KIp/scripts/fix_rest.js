const fs = require('fs');
const path = require('path');
const dir = 'views';

const wordReplacements = [
    { pattern: /Sincron\uFFFD?a/g, replacement: 'Sincronía' },
    { pattern: /activos' %> \uFFFD <%=/g, replacement: 'activos\' %> - <%= ' },
    { pattern: /\uFFFD?ÁÁrea/g, replacement: 'Área' },
    { pattern: /\uFFFDÁÁrea/g, replacement: 'Área' },
    { pattern: /\bÁÁrea/g, replacement: 'Área' },
    { pattern: /newTicketAÁreaLabel/g, replacement: 'newTicketAreaLabel' },
    { pattern: /díata-ticket-elapsed/g, replacement: 'data-ticket-elapsed' },
    { pattern: /tabular-numás/g, replacement: 'tabular-nums' },
    { pattern: /cÁreaci\uFFFD?n/g, replacement: 'creación' },
    { pattern: /disabled>\uFFFD?<\/button>/g, replacement: 'disabled>&lt;</button>' },
    { pattern: /cursor-pointer\">\uFFFD?<\/button>/g, replacement: 'cursor-pointer\">&gt;</button>' },
    { pattern: /Confirmar acci\uFFFD?n/g, replacement: 'Confirmar acción' },
    { pattern: /dirigidía/g, replacement: 'dirigida' },
    { pattern: /asign\uFFFD/g, replacement: 'asignó' },
    { pattern: /Prioridíad/g, replacement: 'Prioridad' },
    { pattern: /B\uFFFD?squedía/g, replacement: 'Búsqueda' },
    { pattern: /Búsquedía/g, replacement: 'Búsqueda' },
    { pattern: /GESTI\uFFFD?N/g, replacement: 'GESTIÓN' },
    { pattern: /CONDICI\uFFFD?N/g, replacement: 'CONDICIÓN' },
    { pattern: /seleccionadía/g, replacement: 'seleccionada' },
    { pattern: /Modíal/g, replacement: 'Modal' }
];

const files = fs.readdirSync(dir).filter(f => f.endsWith('.ejs'));
for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;
  
  for (const {pattern, replacement} of wordReplacements) {
    if (pattern.test(content)) {
      content = content.replace(pattern, replacement);
      changed = true;
    }
  }
  
  if (changed) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('Fixed', file);
  }
}
