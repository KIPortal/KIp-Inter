// Mi perfil: foto (tipo real, peso, nombre del archivo) y cambio de clave. Sin base de datos.
const assert = require('assert');
const path = require('path');
const ejs = require('ejs');
const {
    FOTO_MAX_BYTES, detectImageType, validateFoto, fotoFileName, isValidFotoName, fotoUrl,
    validatePasswordChange, buildProfileView
} = require('../src/services/profileService');
const { buildContacts } = require('../src/services/contactService');

let total = 0, passed = 0;
async function t(name, fn) { total++; try { await fn(); passed++; console.log(`  ✅ [PASS] ${name}`); } catch (e) { console.error(`  ❌ [FAIL] ${name}\n     ${e.message}`); } }

const pad = (cabecera, n = 64) => Buffer.concat([Buffer.from(cabecera), Buffer.alloc(n)]);
const JPG = pad([0xFF, 0xD8, 0xFF, 0xE0]);
const PNG = pad([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(32)]);
const GIF = pad([...Buffer.from('GIF89a')]);
const UUID = '3f2a9c1e-7b4d-4e8a-9c2f-1a2b3c4d5e6f';

(async () => {
    console.log('\n🧪 Mi perfil\n');

    await t('Reconoce JPG, PNG y WebP por sus bytes; rechaza GIF, SVG y texto', () => {
        assert.strictEqual(detectImageType(JPG), 'jpg');
        assert.strictEqual(detectImageType(PNG), 'png');
        assert.strictEqual(detectImageType(WEBP), 'webp');
        assert.strictEqual(detectImageType(GIF), null);
        assert.strictEqual(detectImageType(pad([...Buffer.from('<svg xmlns=')])), null);
        assert.strictEqual(detectImageType(Buffer.from('hola')), null);
        assert.strictEqual(detectImageType('no es buffer'), null);
    });

    await t('La foto vacía, pesada o de otro tipo da un error claro', () => {
        assert.match(validateFoto(Buffer.alloc(0)).error, /Elige/);
        assert.match(validateFoto(undefined).error, /Elige/);
        assert.match(validateFoto({}).error, /Elige/);
        assert.match(validateFoto(Buffer.concat([JPG, Buffer.alloc(FOTO_MAX_BYTES)])).error, /2 MB/);
        assert.match(validateFoto(GIF).error, /JPG, PNG o WebP/);
        assert.deepStrictEqual(validateFoto(PNG), { ext: 'png' });
    });

    await t('Nombre de archivo nuevo en cada subida, sin rutas', () => {
        const a = fotoFileName(UUID, 'jpg', 1000);
        const b = fotoFileName(UUID, 'jpg', 2000);
        assert.notStrictEqual(a, b);
        assert.ok(a.startsWith(UUID + '-') && a.endsWith('.jpg'));
        assert.ok(isValidFotoName(a));
        assert.ok(!fotoFileName('../../etc/passwd', 'png').includes('/'));
        assert.ok(isValidFotoName(fotoFileName('../../etc/passwd', 'png')));
    });

    await t('Solo se sirven nombres generados (sin ../, sin otras extensiones)', () => {
        ['../x.jpg', 'a/b.jpg', 'x.svg', 'x.html', 'x.jpg.exe', '', null, 'a b.png', '.jpg'].forEach(n => assert.ok(!isValidFotoName(n), String(n)));
        assert.strictEqual(fotoUrl(null), null);
        assert.strictEqual(fotoUrl('../x.jpg'), null);
        assert.strictEqual(fotoUrl(UUID + '-abc.webp'), '/perfil/foto/' + UUID + '-abc.webp');
    });

    await t('Cambio de clave: pide la actual correcta, mínimo 8, distinta y confirmada', () => {
        assert.strictEqual(validatePasswordChange({}, 'vieja123').campo, 'actual');
        assert.strictEqual(validatePasswordChange({ actual: 'otra', nueva: 'nueva1234', confirmar: 'nueva1234' }, 'vieja123').campo, 'actual');
        assert.strictEqual(validatePasswordChange({ actual: 'vieja123', nueva: 'corta', confirmar: 'corta' }, 'vieja123').campo, 'nueva');
        assert.strictEqual(validatePasswordChange({ actual: 'vieja123', nueva: 'vieja123', confirmar: 'vieja123' }, 'vieja123').campo, 'nueva');
        assert.strictEqual(validatePasswordChange({ actual: 'vieja123', nueva: 'x'.repeat(73), confirmar: 'x'.repeat(73) }, 'vieja123').campo, 'nueva');
        assert.strictEqual(validatePasswordChange({ actual: 'vieja123', nueva: 'nueva1234', confirmar: 'nueva12345' }, 'vieja123').campo, 'confirmar');
        assert.strictEqual(validatePasswordChange({ actual: { $ne: 1 }, nueva: 'nueva1234', confirmar: 'nueva1234' }, 'vieja123').campo, 'actual');
        assert.deepStrictEqual(validatePasswordChange({ actual: 'vieja123', nueva: 'nueva1234', confirmar: 'nueva1234' }, 'vieja123'), { clave: 'nueva1234' });
    });

    await t('Vista de Mi perfil: datos de Administración en solo lectura y la foto si hay', () => {
        const v = buildProfileView({ id: UUID, nombre: 'Ana Pérez', email: 'ana@x.com', rol: 'COORDINADOR', atiende_tickets: true, telefono: '0212 ext 4', foto: UUID + '-a.png' }, { areaNombre: 'FTTx', subgrupoNombre: 'Soporte' });
        assert.strictEqual(v.iniciales, 'AP');
        assert.strictEqual(v.rolTxt, 'Coordinador');
        assert.strictEqual(v.area, 'FTTx');
        assert.strictEqual(v.subgrupo, 'Soporte');
        assert.strictEqual(v.atiende, true);
        assert.strictEqual(v.foto, '/perfil/foto/' + UUID + '-a.png');
        assert.strictEqual(buildProfileView({ nombre: 'Luis', rol: 'OPERADOR' }).foto, null);
    });

    await t('Contactos lleva la foto de quien la tiene', () => {
        const v = buildContacts({ usuarios: [
            { id: 'a', nombre: 'Ana', email: 'a@x', rol: 'OPERADOR', area_designada: 'GENERAL', foto: 'a-1.jpg' },
            { id: 'b', nombre: 'Beto', email: 'b@x', rol: 'OPERADOR', area_designada: 'GENERAL' }
        ] });
        const personas = v.grupos.flatMap(g => g.personas);
        assert.strictEqual(personas.find(p => p.id === 'a').foto, '/perfil/foto/a-1.jpg');
        assert.strictEqual(personas.find(p => p.id === 'b').foto, null);
    });

    await t('La página dibuja la foto o las iniciales y la barra lateral enlaza a Mi perfil', async () => {
        const archivo = path.join(__dirname, '..', 'views', 'perfil.ejs');
        const conFoto = await ejs.renderFile(archivo, { currentUser: { nombre: 'Ana Pérez', rol: 'OPERADOR', foto: UUID + '-a.png' }, vista: buildProfileView({ nombre: 'Ana Pérez', rol: 'OPERADOR', foto: UUID + '-a.png' }), temporal: false });
        assert.ok(conFoto.includes('<img src="/perfil/foto/' + UUID + '-a.png"'));
        assert.ok(conFoto.includes('href="/perfil"') && conFoto.includes('aria-current="page"'));
        assert.ok(conFoto.includes('Quitar foto'));
        const sinFoto = await ejs.renderFile(archivo, { currentUser: { nombre: 'Ana Pérez', rol: 'OPERADOR' }, vista: buildProfileView({ nombre: 'Ana Pérez', rol: 'OPERADOR', foto: '../x.jpg' }), temporal: true });
        assert.ok(!sinFoto.includes('/perfil/foto/'));
        assert.ok(sinFoto.includes('acceso de desarrollo'));
    });

    console.log(`\n${passed}/${total} pruebas pasaron\n`);
    if (passed !== total) process.exit(1);
})();
