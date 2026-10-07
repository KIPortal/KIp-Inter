const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando carga de datos (Seeding)...');

  // 1. Limpiar solo los tickets para tener métricas frescas (opcional)
  await prisma.ticket.deleteMany({
    where: {
      codigo_incidencia: { startsWith: 'INC-SEED-' }
    }
  });

  // 2. Crear Operadores Simulados (si no existen)
  const areas = ['REDES_FTTH', 'TRAFICO_INALAMBRICO', 'WAN', 'GRANDES_CLIENTES', 'SEGURIDAD', 'TELEFONIA'];
  const operadores = [];
  
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i];
    const email = `op_${area.toLowerCase()}@test.com`;
    
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          clave: '123456',
          nombre: `Especialista ${area}`,
          rol: 'OPERADOR',
          area_designada: area,
          estado_operativo: 'DISPONIBLE'
        }
      });
      console.log(`Creado operador de prueba: ${email}`);
    }
    operadores.push(user);
  }

  // 3. Generar un volumen alto de tickets falsos (Ej. 150 tickets)
  console.log('Generando 150 tickets de prueba con fechas y estados variados...');
  const ticketsData = [];
  
  // Mayor probabilidad de CERRADO para simular un buen volumen de trabajo histórico
  const estados = ['NUEVO', 'EN_PROGRESO', 'EN_PAUSA', 'CERRADO', 'CERRADO', 'CERRADO']; 
  const origenes = ['CORREO', 'LLAMADA', 'JEFATURA', 'COORDINADOR'];
  
  for (let i = 1; i <= 150; i++) {
    const area = areas[Math.floor(Math.random() * areas.length)];
    const operador = operadores.find(op => op.area_designada === area);
    const estado = estados[Math.floor(Math.random() * estados.length)];
    
    // Distribuir los tickets entre hoy y los 4 días anteriores
    const diasAtras = Math.floor(Math.random() * 5); // 0 a 4 días
    const date = new Date();
    date.setDate(date.getDate() - diasAtras);
    // Simular horas pico (8am - 6pm)
    date.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60)); 
    
    let asignado_a_id = null;
    let fecha_asignacion = null;
    let fecha_cierre = null;
    let puntos_complejidad = 0;
    
    // Si no es NUEVO, significa que un operador lo tomó
    if (estado !== 'NUEVO') {
      asignado_a_id = operador.id;
      fecha_asignacion = date;
      
      // Si está CERRADO, asignamos puntos de complejidad y una fecha de cierre
      if (estado === 'CERRADO') {
        puntos_complejidad = Math.floor(Math.random() * 5) + 1; // 1 a 5 puntos de esfuerzo
        const cierreDate = new Date(date);
        cierreDate.setHours(cierreDate.getHours() + 1 + Math.floor(Math.random() * 4)); // Cerrado 1 a 4 horas después
        fecha_cierre = cierreDate;
      }
    }
    
    ticketsData.push({
      codigo_incidencia: `INC-SEED-${Date.now().toString().slice(-4)}${i}`,
      asunto: `Incidencia simulada #${i} en nodo ${area}`,
      descripcion: `Este es un ticket auto-generado por el script de pruebas para visualizar el flujo de trabajo en la sección de reportes. Pertenece al área de ${area}.`,
      remitente: 'monitoreo@noc.local',
      estado_actual: estado,
      puntos_complejidad,
      origen_ingesta: origenes[Math.floor(Math.random() * origenes.length)],
      area_designada: area,
      asignado_a_id,
      createdAt: date,
      updatedAt: fecha_cierre || date,
      fecha_asignacion,
      fecha_cierre,
      resueltoEn: fecha_cierre
    });
  }

  // Insertar todos de golpe
  const result = await prisma.ticket.createMany({
    data: ticketsData
  });

  console.log(`¡Semilla plantada! Se insertaron ${result.count} tickets en la base de datos.`);
}

main()
  .catch(e => {
    console.error('Error durante el seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
