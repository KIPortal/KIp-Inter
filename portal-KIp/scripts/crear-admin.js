/**
 * Crea (o actualiza la clave de) un usuario sin necesidad de seed. Úselo para el primer coordinador:
 *   node scripts/crear-admin.js --email=jefe@empresa.com --nombre="Nombre Apellido" --clave=ClaveSegura1
 * Opciones: --rol=COORDINADOR|OPERADOR (por defecto COORDINADOR), --area=GENERAL|WAN|...
 * Nota: la clave se guarda tal cual mientras no se aplique el cifrado de login (docs/pendientes.md).
 */
const prisma = require('../src/config/prisma');
const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : undefined; };

(async () => {
    const email = arg('email'), nombre = arg('nombre'), clave = arg('clave');
    const rol = arg('rol') || 'COORDINADOR', area = arg('area') || 'GENERAL';
    if (!email || !nombre || !clave) { console.error('Uso: node scripts/crear-admin.js --email=... --nombre="..." --clave=...'); process.exit(1); }
    if (!['COORDINADOR', 'OPERADOR'].includes(rol)) { console.error('Rol inválido'); process.exit(1); }
    const u = await prisma.user.upsert({
        where: { email },
        update: { nombre, clave, rol, area_designada: area },
        create: { email, nombre, clave, rol, area_designada: area }
    });
    console.log(`Usuario listo: ${u.email} (${u.rol}, ${u.area_designada})`);
    await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
