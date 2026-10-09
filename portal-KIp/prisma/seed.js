/**
 * SEED DE PRUEBA COMPLETO - NOC Portal
 * Limpia usuarios/tickets y crea un entorno rico para pruebas de métricas.
 *
 * Estructura:
 *  - 1 Coordinador por área (6 áreas)
 *  - 1 Operador por área (6 áreas)
 *  - 120 tickets con códigos secuenciales INC-0001, INC-0002...
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Áreas disponibles en el sistema
const AREAS = [
  'REDES_FTTH',
  'TRAFICO_INALAMBRICO',
  'WAN',
  'GRANDES_CLIENTES',
  'SEGURIDAD',
  'TELEFONIA',
];

const ORIGENES = ['CORREO', 'LLAMADA', 'JEFATURA', 'COORDINADOR'];

// Distribución de estados: más CERRADO para que las métricas se vean bien
const ESTADOS = ['NUEVO', 'EN_PROGRESO', 'EN_PAUSA', 'CERRADO', 'CERRADO', 'CERRADO', 'CERRADO'];

// Asuntos representativos por área
const ASUNTOS = {
  REDES_FTTH: ['Corte de fibra en sector Norte', 'Degradación de señal en nodo FTTH-22', 'OLT sin respuesta en zona 4', 'Falla masiva de clientes GPON', 'Revisión de empalme en caja NAP'],
  TRAFICO_INALAMBRICO: ['Interferencia en radioenlace BH-14', 'Caída de enlace inalámbrico microondas', 'Alta latencia en sector wireless', 'Antena CPE fuera de alineación', 'Degradación throughput en torre T-07'],
  WAN: ['BGP inestable con upstream', 'Pérdida de paquetes en circuito MPLS', 'Ruta preferente caída por falla ISP', 'Saturación en enlace WAN principal', 'Flapping de interfaz WAN E1'],
  GRANDES_CLIENTES: ['Corte de servicio corporativo en sede central', 'SLA incumplido cliente Tier-1', 'VPN cliente caída por cambio de IP', 'Baja velocidad contratada detectada', 'Falla en acceso dedicado cliente premium'],
  SEGURIDAD: ['Alerta IDS de tráfico anómalo', 'Intento de intrusión detectado en firewall', 'Certificado SSL expirado en portal', 'Bloqueo de IP sospechosa', 'Revisión de política de ACL'],
  TELEFONIA: ['Cola de llamadas desbordada en PBX', 'Troncal SIP caída', 'Echo detectado en conferencias', 'Falla en módulo de voz CUCM', 'Número 1800 no responde'],
};

async function main() {
  console.log('============================================');
  console.log('   NOC Portal — Seed de Prueba Completo');
  console.log('============================================\n');

  // --- PASO 1: LIMPIEZA TOTAL ---
  console.log('[1/3] Limpiando base de datos...');
  await prisma.ticket.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('    ✓ Tickets y usuarios eliminados.\n');

  // --- PASO 2: CREAR USUARIOS ---
  console.log('[2/3] Creando coordinadores y operadores...');
  const operadoresPorArea = {};

  for (const area of AREAS) {
    const areaLabel = area.replace(/_/g, ' ').toLowerCase();

    // Coordinador del área
    await prisma.user.create({
      data: {
        email: `coord_${area.toLowerCase()}@test.com`,
        clave: 'admin123',
        nombre: `Coordinador ${areaLabel}`,
        rol: 'COORDINADOR',
        area_designada: area,
        estado_operativo: 'DISPONIBLE',
      }
    });

    // Operador del área
    const operador = await prisma.user.create({
      data: {
        email: `op_${area.toLowerCase()}@test.com`,
        clave: 'op123',
        nombre: `Operador ${areaLabel}`,
        rol: 'OPERADOR',
        area_designada: area,
        estado_operativo: 'DISPONIBLE',
      }
    });

    operadoresPorArea[area] = operador;
    console.log(`    ✓ Coordinador + Operador para: ${area}`);
  }
  console.log();

  // --- PASO 3: CREAR TICKETS (batch) ---
  console.log('[3/3] Generando 120 tickets con códigos INC-XXXX...');
  const ticketsData = [];

  for (let i = 0; i < 50; i++) {
    const area = AREAS[Math.floor(Math.random() * AREAS.length)];
    const operador = operadoresPorArea[area];
    const estado = ESTADOS[Math.floor(Math.random() * ESTADOS.length)];
    const asuntoList = ASUNTOS[area];
    const asunto = asuntoList[Math.floor(Math.random() * asuntoList.length)];

    const diasAtras = Math.floor(Math.random() * 7);
    const createdAt = new Date();
    createdAt.setDate(createdAt.getDate() - diasAtras);
    createdAt.setHours(7 + Math.floor(Math.random() * 14), Math.floor(Math.random() * 60), 0, 0);

    let asignado_a_id = null;
    let fecha_asignacion = null;
    let fecha_cierre = null;
    let resueltoEn = null;
    let puntos_complejidad = 0;

    if (estado !== 'NUEVO') {
      asignado_a_id = operador.id;
      fecha_asignacion = createdAt;

      if (estado === 'CERRADO') {
        puntos_complejidad = Math.floor(Math.random() * 8) + 1;
        const minsResolucion = 30 + Math.floor(Math.random() * 330);
        fecha_cierre = new Date(createdAt.getTime() + minsResolucion * 60 * 1000);
        resueltoEn = fecha_cierre;
      }
    }

    const codigo = `INC-${String(i + 1).padStart(4, '0')}`;

    ticketsData.push({
      codigo_incidencia: codigo,
      asunto,
      descripcion: `Ticket #${i + 1} generado por seed. Área: ${area}.`,
      remitente: 'monitoreo@noc.local',
      estado_actual: estado,
      puntos_complejidad,
      origen_ingesta: ORIGENES[Math.floor(Math.random() * ORIGENES.length)],
      area_designada: area,
      asignado_a_id,
      fecha_asignacion,
      fecha_cierre,
      resueltoEn,
      createdAt,
      updatedAt: fecha_cierre || createdAt,
    });
  }

  const result = await prisma.ticket.createMany({ data: ticketsData });
  console.log(`    ✓ ${result.count} tickets creados: INC-0001 a INC-${String(result.count).padStart(4, '0')}\n`);

  console.log('============================================');
  console.log('   Seed completado exitosamente.');
  console.log('============================================');
}

main()
  .catch(e => {
    console.error('\n[ERROR] Fallo durante el seed:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
