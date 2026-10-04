const fs = require('node:fs');
const path = require('node:path');

const assetsRoot = path.resolve(__dirname, '..', 'views', 'components', 'assets');
const ignoredHeadings = /^(auto layout|inside auto layout|identical to|or\s|note:)/i;
const positionalProperties = new Set(['left', 'right', 'top', 'bottom']);

function slug(value) {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'layer';
}

function collectFiles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) return collectFiles(entryPath);
        if (!entry.isFile() || !['.txt', '.css'].includes(path.extname(entry.name))) return [];
        if (path.basename(entry.name) === 'figma-tokens.css') return [];
        return [entryPath];
    });
}

function isColor(value) {
    return /^(#[\da-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|transparent|currentcolor|black|white)$/i.test(value.trim());
}

function transformDeclarations(declarations) {
    const output = [];

    for (const [property, value] of declarations) {
        if (property === 'position' && value.toLowerCase() === 'absolute') continue;
        if (positionalProperties.has(property)) continue;
        if (property === 'letter-spacing' && /^-/.test(value)) {
            output.push('    letter-spacing: 0;');
            continue;
        }

        if (property === 'color' && isColor(value)) {
            output.push(`    --figma-ink: ${value};`, '    @apply figma-text-ink;');
        } else if (['background', 'background-color'].includes(property) && isColor(value)) {
            output.push(`    --figma-muted-fill: ${value};`, '    @apply figma-surface-muted;');
        } else if (property === 'box-shadow') {
            output.push(`    --figma-panel-shadow: ${value};`, '    @apply figma-shadow-panel;');
        } else if (property === 'border' && /^\s*[\d.]+(?:px|rem|em|%)\s+(?:solid|dashed|dotted|double|none)\s+/i.test(value)) {
            const match = value.match(/^\s*([\d.]+(?:px|rem|em|%))\s+(solid|dashed|dotted|double|none)\s+(.+)$/i);
            output.push(`    --figma-subtle-border: ${match[3]};`, '    @apply figma-border-subtle;', `    border-width: ${match[1]};`, `    border-style: ${match[2]};`);
        } else if (property === 'border-color' && isColor(value)) {
            output.push(`    --figma-subtle-border: ${value};`, '    @apply figma-border-subtle;');
        } else {
            output.push(`    ${property}: ${value};`);
        }
    }

    return output;
}

function convertFile(filePath) {
    const relativePath = path.relative(assetsRoot, filePath);
    const fileSlug = slug(relativePath.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '-'));
    const source = fs.readFileSync(filePath, 'utf8');
    if (path.extname(filePath) === '.css' && /^\s*\.[^{]+\{/m.test(source)) return false;
    const lines = source.split(/\r?\n/);
    const rules = [];
    const usedNames = new Map();
    let layerSlug = null;
    let declarations = [];

    function flush() {
        const body = transformDeclarations(declarations);
        if (body.length) {
            const selector = layerSlug ? `.figma-${fileSlug}__${layerSlug}` : `.figma-${fileSlug}`;
            rules.push(`${selector} {\n${body.join('\n')}\n}`);
        }
        declarations = [];
    }

    for (const line of lines) {
        const comment = line.match(/^\s*\/\*\s*(.*?)\s*\*\/\s*$/);
        if (comment) {
            const heading = comment[1].trim();
            if (heading && !ignoredHeadings.test(heading)) {
                flush();
                const baseName = slug(heading);
                const occurrence = (usedNames.get(baseName) || 0) + 1;
                usedNames.set(baseName, occurrence);
                layerSlug = occurrence === 1 ? baseName : `${baseName}-${occurrence}`;
            }
            continue;
        }

        const declaration = line.match(/^\s*([a-zA-Z-]+)\s*:\s*(.*?)\s*;\s*(?:\/\*.*\*\/\s*)?$/);
        if (declaration) declarations.push([declaration[1].toLowerCase(), declaration[2].trim()]);
    }
    flush();

    const outputPath = filePath.replace(/\.txt$/i, '.css');
    fs.writeFileSync(outputPath, `${rules.join('\n\n')}\n`);
    if (outputPath !== filePath) fs.unlinkSync(filePath);
    return true;
}

const files = collectFiles(assetsRoot);
const convertedCount = files.filter(convertFile).length;
console.log(`Converted ${convertedCount} Figma asset files to class-based CSS.`);