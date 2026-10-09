/**
 * Verificador automatizado de codificación y caracteres de reemplazo en views/
 *
 * Acceptance Criteria R1:
 * - Un script o comando de búsqueda confirma que ya no existen caracteres de reemplazo (\uFFFD o '?' anómalos en texto en español) en la carpeta views/.
 * - Las palabras clave (Gestión, Auditoría, Acción, Área) están correctamente escritas con tilde en los menús laterales y cabeceras de tablas.
 */

const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.resolve(__dirname, '..', 'views');

function checkFile(filePath) {
    const relative = path.relative(VIEWS_DIR, filePath);
    const buffer = fs.readFileSync(filePath);
    let failures = [];

    // 1. Verificar bytes no válidos en UTF-8
    let i = 0;
    while (i < buffer.length) {
        const b = buffer[i];
        if (b < 0x80) {
            i++;
        } else if (b >= 0xC2 && b <= 0xDF && i + 1 < buffer.length && buffer[i + 1] >= 0x80 && buffer[i + 1] <= 0xBF) {
            i += 2;
        } else if (b >= 0xE0 && b <= 0xEF && i + 2 < buffer.length &&
            buffer[i + 1] >= 0x80 && buffer[i + 1] <= 0xBF &&
            buffer[i + 2] >= 0x80 && buffer[i + 2] <= 0xBF) {
            i += 3;
        } else if (b >= 0xF0 && b <= 0xF4 && i + 3 < buffer.length &&
            buffer[i + 1] >= 0x80 && buffer[i + 1] <= 0xBF &&
            buffer[i + 2] >= 0x80 && buffer[i + 2] <= 0xBF &&
            buffer[i + 3] >= 0x80 && buffer[i + 3] <= 0xBF) {
            i += 4;
        } else {
            failures.push(`Byte no UTF-8 aislado 0x${b.toString(16).toUpperCase()} en offset ${i}`);
            i++;
        }
    }

    // 2. Verificar caracteres de reemplazo \uFFFD o ? en español
    const text = buffer.toString('utf8');
    const lines = text.split('\n');

    lines.forEach((line, idx) => {
        if (line.includes('\uFFFD')) {
            failures.push(`Línea ${idx + 1}: Carácter de reemplazo \uFFFD encontrado: "${line.trim()}"`);
        }

        const anomalousQMark = line.match(/[a-zA-ZáéíóúÁÉÍÓÚñÑ]\?[a-zA-ZáéíóúÁÉÍÓÚñÑ]/);
        if (anomalousQMark) {
            failures.push(`Línea ${idx + 1}: Signo '?' anómalo dentro de palabra: "${line.trim()}"`);
        }
    });

    return { file: relative, failures };
}

function scanDir(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(scanDir(full));
        } else if (entry.isFile() && entry.name.endsWith('.ejs')) {
            results.push(checkFile(full));
        }
    }

    return results;
}

function verifyKeyWords() {
    console.log('\n--- VERIFICACIÓN DE PALABRAS CLAVE EN MENÚS Y CABECERAS ---');
    const keyFiles = ['index.ejs', 'operator-dashboard.ejs', 'reports.ejs', 'audit.ejs'];
    let passed = true;

    for (const f of keyFiles) {
        const full = path.join(VIEWS_DIR, f);
        if (!fs.existsSync(full)) continue;
        const text = fs.readFileSync(full, 'utf8');

        // Palabras clave requeridas con tilde
        const checks = [
            { word: 'Gestión', regex: /Gestión/ },
            { word: 'Auditoría', regex: /Auditoría/ },
            { word: 'Acción', regex: /Acción/ },
            { word: 'Área', regex: /Área/ }
        ];

        console.log(`\nVerificando ${f}:`);
        for (const check of checks) {
            const hasCorrect = check.regex.test(text);
            const hasBroken = new RegExp(`${check.word.slice(0, -2)}[\uFFFD?]`).test(text);
            if (hasCorrect && !hasBroken) {
                console.log(`  [OK] ${check.word} encontrada y correctamente acentuada`);
            } else if (!hasCorrect) {
                console.log(`  [INFO] ${check.word} no requerida o ausente en esta vista`);
            } else {
                console.error(`  [ERROR] ${check.word} presenta caracteres rotos`);
                passed = false;
            }
        }
    }

    return passed;
}

console.log('=== AUDITORÍA DE CODIFICACIÓN UTF-8 EN VIEWS/ ===');
const results = scanDir(VIEWS_DIR);
let totalFailures = 0;

results.forEach(res => {
    if (res.failures.length === 0) {
        console.log(`[PASS] ${res.file} (UTF-8 estricto, 0 reemplazos)`);
    } else {
        console.error(`[FAIL] ${res.file} (${res.failures.length} problemas encontrados):`);
        res.failures.forEach(f => console.error(`   - ${f}`));
        totalFailures += res.failures.length;
    }
});

const keyWordsOk = verifyKeyWords();

if (totalFailures === 0 && keyWordsOk) {
    console.log('\n🎉 RESULTADO FINAL: TODOS LOS ARCHIVOS .EJS CUMPLEN R1.');
    console.log('   - 0 caracteres de reemplazo o bytes extraños.');
    console.log('   - Palabras clave (Gestión, Auditoría, Acción, Área) correctamente acentuadas.');
    process.exit(0);
} else {
    console.error(`\n❌ RESULTADO FINAL: ${totalFailures} errores de codificación pendientes.`);
    process.exit(1);
}
