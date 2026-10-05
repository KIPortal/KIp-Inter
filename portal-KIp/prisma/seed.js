const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Iniciando seeder para pruebas (Coordinador y Operador)...');

    // Limpiar base de datos para pruebas limpias
    await prisma.ticket.deleteMany({});
    await prisma.user.deleteMany({});
    
    // Crear Coordinador
    const coordinador = await prisma.user.create({
        data: {
            email: 'coordinador@test.com',
            clave: 'password123', // clave de email (simulada)
            nombre: 'Juan Coordinador',
            rol: 'COORDINADOR',
            area_designada: 'GENERAL',
            estado_operativo: 'DISPONIBLE'
        }
    });

    // Crear Operador
    const operador = await prisma.user.create({
        data: {
            email: 'operador@test.com',
            clave: 'password123',
            nombre: 'Pedro Operador',
            rol: 'OPERADOR',
            area_designada: 'GENERAL',
            estado_operativo: 'DISPONIBLE'
        }
    });

    // Crear un Operador para el área de Redes
    const operadorRedes = await prisma.user.create({
        data: {
            email: 'redes@test.com',
            clave: 'password123',
            nombre: 'Ana Redes',
            rol: 'OPERADOR',
            area_designada: 'REDES_FTTH',
            estado_operativo: 'DISPONIBLE'
        }
    });

    console.log('✅ Usuarios creados:');
    console.log('- Coordinador: coordinador@test.com / password123');
    console.log('- Operador General: operador@test.com / password123');
    console.log('- Operador Redes: redes@test.com / password123');

    // Crear Tickets de prueba
    await prisma.ticket.createMany({
        data: [
            {
                codigo_incidencia: 'INC-001',
                asunto: 'Corte de fibra óptica en sector norte',
                descripcion: 'Se reporta pérdida de señal PON',
                estado_actual: 'NUEVO',
                area_designada: 'REDES_FTTH',
                creado_por_id: coordinador.id,
            },
            {
                codigo_incidencia: 'INC-002',
                asunto: 'Revisión de antena inalambrica',
                descripcion: 'Mantenimiento preventivo',
                estado_actual: 'NUEVO',
                area_designada: 'TRAFICO_INALAMBRICO',
                creado_por_id: coordinador.id,
            },
            {
                codigo_incidencia: 'INC-003',
                asunto: 'Falla masiva general',
                descripcion: 'Múltiples llamadas sobre caída del servicio',
                estado_actual: 'NUEVO',
                area_designada: 'GENERAL',
                creado_por_id: coordinador.id,
            },
            // Ticket asignado en progreso
            {
                codigo_incidencia: 'INC-004',
                asunto: 'Asignación directa a Pedro',
                descripcion: 'Problema en nodo central',
                estado_actual: 'EN_PROGRESO',
                area_designada: 'GENERAL',
                asignado_a_id: operador.id,
                creado_por_id: coordinador.id,
                fecha_asignacion: new Date()
            },
            // Ticket pausado
            {
                codigo_incidencia: 'INC-005',
                asunto: 'Revisión de cableado',
                descripcion: 'Pendiente de materiales',
                estado_actual: 'EN_PAUSA',
                area_designada: 'GENERAL',
                asignado_a_id: operador.id,
                creado_por_id: coordinador.id,
                fecha_asignacion: new Date()
            }
        ]
    });

    console.log('✅ Tickets creados exitosamente.');
    console.log('🎉 Seed finalizado. Ya puedes probar el login y los dashboards.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
