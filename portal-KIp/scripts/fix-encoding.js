/**
 * Script de corrección y verificación de codificación UTF-8 para archivos EJS
 * 
 * Requisito R1: Corregir caracteres rotos / ? / \uFFFD en views/*.ejs,
 * restaurando tildes y eñes (Gestión, Auditoría, Acción, Área, etc.)
 * y asegurando guardado estricto en UTF-8.
 */

const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.resolve(__dirname, '..', 'views');

// Mapeo exhaustivo de patrones dañados (tanto \uFFFD como ? anómalos en español)
const WORD_REPLACEMENTS = [
    // Títulos y secciones principales
    [/\bAuditor[\uFFFD?]a\b/g, 'Auditoría'],
    [/\bAUDITOR[\uFFFD?]A\b/g, 'AUDITORÍA'],
    [/\bGesti[\uFFFD?]n\b/g, 'Gestión'],
    [/\bGESTI[\uFFFD?]N\b/g, 'GESTIÓN'],
    [/\bAcci[\uFFFD?]n\b/g, 'Acción'],
    [/\bACCI[\uFFFD?]N\b/g, 'ACCIÓN'],
    [/\b[\uFFFD?]rea\b/g, 'Área'],
    [/\b[\uFFFD?]REA\b/g, 'ÁREA'],
    [/\b[\uFFFD?]reas\b/g, 'Áreas'],
    [/\b[\uFFFD?]REAS\b/g, 'ÁREAS'],
    [/\bSesi[\uFFFD?]n\b/g, 'Sesión'],
    [/\bSESI[\uFFFD?]N\b/g, 'SESIÓN'],
    [/\bNavegaci[\uFFFD?]n\b/g, 'Navegación'],
    [/\bNAVEGACI[\uFFFD?]N\b/g, 'NAVEGACIÓN'],
    [/\bSincron[\uFFFD?]a\b/g, 'Sincronía'],
    [/\bSINCRON[\uFFFD?]A\b/g, 'SINCRONÍA'],
    [/\bCR[\uFFFD?]TICOS\b/g, 'CRÍTICOS'],
    [/\bCr[\uFFFD?]ticos\b/g, 'Críticos'],
    [/\bCr[\uFFFD?]tico\b/g, 'Crítico'],
    [/\bCr[\uFFFD?]tica\b/g, 'Crítica'],
    [/\bTr[\uFFFD?]fico\b/g, 'Tráfico'],
    [/\bTR[\uFFFD?]FICO\b/g, 'TRÁFICO'],
    [/\binal[\uFFFD?]mbrico\b/g, 'inalámbrico'],
    [/\bINAL[\uFFFD?]MBRICO\b/g, 'INALÁMBRICO'],
    [/\bTelefon[\uFFFD?]a\b/g, 'Telefonía'],
    [/\bTELEFON[\uFFFD?]A\b/g, 'TELEFONÍA'],
    [/\bDescripci[\uFFFD?]n\b/g, 'Descripción'],
    [/\bDESCRIPCI[\uFFFD?]N\b/g, 'DESCRIPCIÓN'],
    [/\bC[\uFFFD?]digo\b/g, 'Código'],
    [/\bC[\uFFFD?]DIGO\b/g, 'CÓDIGO'],
    [/\bS[\uFFFD?]ntomas\b/g, 'Síntomas'],
    [/\bt[\uFFFD?]cnico\b/g, 'técnico'],
    [/\bt[\uFFFD?]cnica\b/g, 'técnica'],
    [/\bcreaci[\uFFFD?]n\b/g, 'creación'],
    [/\bCREACI[\uFFFD?]N\b/g, 'CREACIÓN'],
    [/\basignaci[\uFFFD?]n\b/g, 'asignación'],
    [/\bASIGNACI[\uFFFD?]N\b/g, 'ASIGNACIÓN'],
    [/\bAsignaci[\uFFFD?]n\b/g, 'Asignación'],
    [/\bdesasignaci[\uFFFD?]n\b/g, 'desasignación'],
    [/\bconfirmaci[\uFFFD?]n\b/g, 'confirmación'],
    [/\bresoluci[\uFFFD?]n\b/g, 'resolución'],
    [/\bselecci[\uFFFD?]n\b/g, 'selección'],
    [/\bopci[\uFFFD?]n\b/g, 'opción'],
    [/\banimaci[\uFFFD?]n\b/g, 'animación'],
    [/\bNotificaci[\uFFFD?]n\b/g, 'Notificación'],
    [/\bB[\uFFFD?]squeda\b/g, 'Búsqueda'],
    [/\bDise[\uFFFD?]o\b/g, 'Diseño'],
    [/\bDISE[\uFFFD?]O\b/g, 'DISEÑO'],
    [/\bd[\uFFFD?]a\b/g, 'día'],
    [/\bd[\uFFFD?]as\b/g, 'días'],
    [/\bv[\uFFFD?]lidos\b/g, 'válidos'],
    [/\bv[\uFFFD?]lido\b/g, 'válido'],
    [/\bm[\uFFFD?]ltiple\b/g, 'múltiple'],
    [/\bespec[\uFFFD?]fica\b/g, 'específica'],
    [/\bespec[\uFFFD?]fico\b/g, 'específico'],
    [/\bcom[\uFFFD?]n\b/g, 'común'],
    [/\bInt[\uFFFD?]ntalo\b/g, 'Inténtalo'],
    [/\bseg[\uFFFD?]n\b/g, 'según'],
    [/\best[\uFFFD?]n\b/g, 'estén'],
    [/\bbot[\uFFFD?]n\b/g, 'botón'],
    [/\bAuto-inicializaci[\uFFFD?]n\b/g, 'Auto-inicialización'],
    [/\bL[\uFFFD?]DER\b/g, 'LÍDER'],
    [/\bL[\uFFFD?]der\b/g, 'Líder'],

    // Frases específicas en index.ejs
    [/\? L[\uFFFD?]DER ACTIVO/g, '● LÍDER ACTIVO'],
    [/[\uFFFD?] L[\uFFFD?]DER ACTIVO/g, '● LÍDER ACTIVO'],
    [/'[\uFFFD?] Sin asignar'/g, "'● Sin asignar'"],
    [/"[\uFFFD?] Sin asignar"/g, '"● Sin asignar"'],
    [/`[\uFFFD?]Confirmar/g, '`¿Confirmar'],
    [/`[\uFFFD?]Confirmas/g, '`¿Confirmas'],
    [/\bdesasignar[\uFFFD?]/g, 'desasignará'],
    [/\bvolver[\uFFFD?]/g, 'volverá'],
    [/\beliminar[\uFFFD?]/g, 'eliminará'],
    [/\basign[\uFFFD?]\b/g, 'asignó'],
    [/\bse asign[\uFFFD?]\b/g, 'se asignó'],

    // Signos y viñetas (la paginación se maneja específicamente en processFile)
    [/'[\uFFFD?]\s*Sin asignar'/g, "'● Sin asignar'"],
    [/"[\uFFFD?]\s*Sin asignar"/g, '"● Sin asignar"'],
];

// Reemplazos de byte crudo cuando el archivo fue grabado como Windows-1252 / ISO-8859-1
function repairRawBytes(buffer) {
    const bytes = [];
    let i = 0;
    while (i < buffer.length) {
        const b = buffer[i];

        // Secuencias UTF-8 válidas de 1 byte (ASCII: 0x00 - 0x7F)
        if (b < 0x80) {
            bytes.push(b);
            i++;
            continue;
        }

        // Secuencias UTF-8 válidas de 2 bytes (0xC2 - 0xDF seguido de 0x80 - 0xBF)
        if (b >= 0xC2 && b <= 0xDF && i + 1 < buffer.length && buffer[i + 1] >= 0x80 && buffer[i + 1] <= 0xBF) {
            bytes.push(b, buffer[i + 1]);
            i += 2;
            continue;
        }

        // Secuencias UTF-8 válidas de 3 bytes (0xE0 - 0xEF seguido de dos bytes 0x80 - 0xBF)
        if (b >= 0xE0 && b <= 0xEF && i + 2 < buffer.length &&
            buffer[i + 1] >= 0x80 && buffer[i + 1] <= 0xBF &&
            buffer[i + 2] >= 0x80 && buffer[i + 2] <= 0xBF) {
            bytes.push(b, buffer[i + 1], buffer[i + 2]);
            i += 3;
            continue;
        }

        // Secuencias UTF-8 válidas de 4 bytes (0xF0 - 0xF4 seguido de tres bytes 0x80 - 0xBF)
        if (b >= 0xF0 && b <= 0xF4 && i + 3 < buffer.length &&
            buffer[i + 1] >= 0x80 && buffer[i + 1] <= 0xBF &&
            buffer[i + 2] >= 0x80 && buffer[i + 2] <= 0xBF &&
            buffer[i + 3] >= 0x80 && buffer[i + 3] <= 0xBF) {
            bytes.push(b, buffer[i + 1], buffer[i + 2], buffer[i + 3]);
            i += 4;
            continue;
        }

        // Si llegamos aquí, 'b' es un byte aislado no UTF-8 (típico de Windows-1252 / Latin-1)
        // Mapear byte a su caracter UTF-8 correspondiente:
        const charMap = {
            0xED: 'í', // 237
            0xF3: 'ó', // 243
            0xE1: 'á', // 225
            0xE9: 'é', // 233
            0xFA: 'ú', // 250
            0xF1: 'ñ', // 241
            0xCD: 'Í', // 205
            0xD3: 'Ó', // 211
            0xC1: 'Á', // 193
            0xC9: 'É', // 201
            0xDA: 'Ú', // 218
            0xD1: 'Ñ', // 209
            0xBF: '¿', // 191
            0xA1: '¡', // 161
            0xB7: '·', // 183
            0xAB: '«', // 171
            0xBB: '»', // 187
            0x95: '●', // 149 (Bullet en Windows-1252)
        };

        const replacement = charMap[b];
        if (replacement) {
            const utf8Bytes = Buffer.from(replacement, 'utf8');
            for (const ub of utf8Bytes) bytes.push(ub);
        } else {
            // Si es un caracter desconocido, mantener o sustituir
            bytes.push(b);
        }
        i++;
    }

    return Buffer.from(bytes);
}

function processFile(filePath) {
    const rawBuffer = fs.readFileSync(filePath);
    const repairedBuffer = repairRawBytes(rawBuffer);
    let content = repairedBuffer.toString('utf8');

    // Aplicar reemplazos de cadenas de texto
    for (const [pattern, replacement] of WORD_REPLACEMENTS) {
        content = content.replace(pattern, replacement);
    }

    // Regla especial para los botones de paginación en index.ejs si quedaron como '?' o \uFFFD
    content = content.replace(/disabled>[\uFFFD?]?<\/button>/g, 'disabled>«</button>');
    content = content.replace(/cursor-pointer">[\uFFFD?]?<\/button>/g, 'cursor-pointer">»</button>');

    // Asegurarse de que las palabras clave de los requerimientos estén perfectas
    content = content.replace(/aria-label="Gesti[\uFFFD?]n de Turno"/g, 'aria-label="Gestión de Turno"');
    content = content.replace(/aria-label="Gesti.*?n de Turno"/g, 'aria-label="Gestión de Turno"');
    content = content.replace(/>Gesti[\uFFFD?]n de Turno</g, '>Gestión de Turno<');
    content = content.replace(/>Auditor[\uFFFD?]a</g, '>Auditoría<');
    // Reglas para indicadores de ordenación y caracteres especiales
    content = content.replace(/id="dateSortIndicator"[^>]*>[\uFFFD?]?<\/span>/g, 'id="dateSortIndicator" class="text-[9px] text-[#8E8E93] leading-none">▼</span>');
    content = content.replace(/indicator\.textContent = dateSortAsc \? '[^']*' : '[^']*';/g, "indicator.textContent = dateSortAsc ? '▲' : '▼';");
    content = content.replace(/['"][\uFFFD?]\s*L[\uFFFD?]DER ACTIVO['"]/g, "'● LÍDER ACTIVO'");
    content = content.replace(/['"][\uFFFD?]\s*Sin asignar['"]/g, "'● Sin asignar'");
    content = content.replace(/`[\uFFFD?](Confirmar|Confirmas)/g, '`¿$1');
    content = content.replace(/\best[\uFFFD?]\s+oculto\b/g, 'está oculto');
    content = content.replace(/\bque NO est[\uFFFD?]n\b/g, 'que NO estén');
    content = content.replace(/\bcom[\uFFFD?]n\b/g, 'común');
    content = content.replace(/\bm[\uFFFD?]ltiple\b/g, 'múltiple');
    content = content.replace(/\bse asign[\uFFFD?]\b/g, 'se asignó');
    content = content.replace(/\bconfirm[\uFFFD?]\b/g, 'confirmó');
    content = content.replace(/\bdesasignar[\uFFFD?]\b/g, 'desasignará');
    content = content.replace(/\bvolver[\uFFFD?]\b/g, 'volverá');
    content = content.replace(/\beliminar[\uFFFD?]\b/g, 'eliminará');

    // Guardar estrictamente en formato UTF-8 (sin BOM)
    fs.writeFileSync(filePath, content, { encoding: 'utf8' });
    console.log(`[UTF-8 OK] Procesado: ${path.relative(VIEWS_DIR, filePath)}`);
}

function scanAndFixDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            scanAndFixDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.ejs')) {
            processFile(fullPath);
        }
    }
}

function verifyEncoding(dir) {
    console.log('\n--- VERIFICACIÓN DE CODIFICACIÓN EN VIEWS/ ---');
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let totalErrors = 0;

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            totalErrors += verifyEncoding(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.ejs')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            const lines = content.split('\n');

            lines.forEach((line, lineNum) => {
                // Buscar caracteres de reemplazo U+FFFD
                if (line.includes('\uFFFD')) {
                    console.error(`[FALLA \uFFFD] ${entry.name}:${lineNum + 1}: ${line.trim()}`);
                    totalErrors++;
                }

                // Buscar '?' anómalos en medio de palabras (ej. Gesti?n, Auditor?a, Acci?n, ?rea)
                const anomalousMatch = line.match(/[a-zA-ZáéíóúÁÉÍÓÚñÑ]\?[a-zA-ZáéíóúÁÉÍÓÚñÑ]/);
                if (anomalousMatch) {
                    console.error(`[FALLA ?] ${entry.name}:${lineNum + 1}: ${line.trim()}`);
                    totalErrors++;
                }
            });
        }
    }

    return totalErrors;
}

// Ejecución principal
console.log('Iniciando corrección de codificación UTF-8 en carpeta views/ ...');
scanAndFixDir(VIEWS_DIR);

const errors = verifyEncoding(VIEWS_DIR);
if (errors === 0) {
    console.log('\n✅ ÉXITO: Todos los archivos .ejs en views/ están estrictamente codificados en UTF-8 y libres de caracteres rotos o ?.');
    process.exit(0);
} else {
    console.error(`\n❌ ERROR: Se encontraron ${errors} problemas de codificación residuales.`);
    process.exit(1);
}
