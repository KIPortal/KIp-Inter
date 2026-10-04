const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');
const tailwindcss = require('tailwindcss');

const projectRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(projectRoot, 'views', 'components', 'assets');
const outputPath = path.join(projectRoot, 'public', 'css', 'figma-assets.css');
const tailwindConfig = require(path.join(projectRoot, 'tailwind.config.js'));

function collectStyles(directory) {
    return fs.readdirSync(directory, { withFileTypes: true })
        .sort((first, second) => first.name.localeCompare(second.name))
        .flatMap((entry) => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) return collectStyles(entryPath);
            return entry.isFile() && entry.name.endsWith('.css') ? [fs.readFileSync(entryPath, 'utf8')] : [];
        });
}

const input = `@tailwind components;\n@tailwind utilities;\n${collectStyles(assetsRoot).join('\n')}`;

postcss([tailwindcss(tailwindConfig)])
    .process(input, { from: undefined })
    .then(({ css }) => {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, css);
        console.log(`Compiled Figma CSS assets to ${path.relative(projectRoot, outputPath)}`);
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });