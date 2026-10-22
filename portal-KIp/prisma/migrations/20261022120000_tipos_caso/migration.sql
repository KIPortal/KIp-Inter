-- Tipos de caso (casos comunes) por área con su nivel de dificultad 1-4.
-- Los puntos de carga de un ticket salen del nivel (N1=2, N2=4, N3=8, N4=10) y la prioridad
-- (P1/P2/P3) pasa a su propia columna: marca la urgencia y ya no da puntos.

-- 1. Ticket: prioridad, nivel y tipo de caso
ALTER TABLE "Ticket" ADD COLUMN "nivel" INTEGER,
ADD COLUMN "prioridad" VARCHAR(2),
ADD COLUMN "tipo_caso_id" TEXT;

-- La prioridad de los tickets existentes sale de sus puntos de antes (P1=8, P2=5, P3=1).
-- Sus puntos no cambian: el historial se conserva tal como se midió.
UPDATE "Ticket" SET "prioridad" = CASE "puntos_complejidad" WHEN 8 THEN 'P1' WHEN 5 THEN 'P2' WHEN 1 THEN 'P3' END
WHERE "puntos_complejidad" IN (8, 5, 1);

-- 2. Catálogo de tipos de caso
CREATE TABLE "TipoCaso" (
    "id" TEXT NOT NULL,
    "area_codigo" VARCHAR(40) NOT NULL,
    "subgrupo_id" TEXT,
    "nombre" VARCHAR(120) NOT NULL,
    "nivel" INTEGER NOT NULL,
    "minutos_estimados" INTEGER,
    "frecuencia" VARCHAR(5),
    "dependencias" VARCHAR(200),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoCaso_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TipoCaso_area_codigo_activo_idx" ON "TipoCaso"("area_codigo", "activo");
CREATE UNIQUE INDEX "TipoCaso_area_codigo_nombre_key" ON "TipoCaso"("area_codigo", "nombre");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tipo_caso_id_fkey" FOREIGN KEY ("tipo_caso_id") REFERENCES "TipoCaso"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TipoCaso" ADD CONSTRAINT "TipoCaso_area_codigo_fkey" FOREIGN KEY ("area_codigo") REFERENCES "Area"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TipoCaso" ADD CONSTRAINT "TipoCaso_subgrupo_id_fkey" FOREIGN KEY ("subgrupo_id") REFERENCES "Subgrupo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TipoCaso" ENABLE ROW LEVEL SECURITY;

-- 3. Catálogo inicial: los Excel "Actividades Soporte FTTX" y "Indicadores Puntos y Niveles WAN" (oct 2026).
-- Si el área no existe no se inserta nada; si ya hay un tipo con ese nombre, se deja como está.
-- FTTx: área REDES_FTTH (o la que tenga "FTT" en el nombre), subgrupo Soporte si existe.
WITH area AS (
    SELECT "codigo" FROM "Area" WHERE "codigo" = 'REDES_FTTH' OR "nombre" ILIKE '%ftt%'
    ORDER BY ("codigo" = 'REDES_FTTH') DESC, "orden" LIMIT 1
), datos ("nombre", "nivel", "minutos", "frecuencia", "dependencias") AS (VALUES
    ('MAC en Rojo', 1, 15, 'ALTA', NULL),
    ('Actualización de firmware de una ONU', 1, 10, 'MEDIA', NULL),
    ('Configuración de IP Certificada', 2, 20, 'ALTA', 'UN y Cliente'),
    ('Soporte a IP Certificada', 2, 20, 'ALTA', 'Cliente y Sistemas Nacionales'),
    ('Configuración de OLT', 4, 120, 'MEDIA', 'HE'),
    ('Configuración de Cliente B2B', 2, 20, 'BAJA', NULL),
    ('Soporte a Cliente B2B', 2, 20, 'BAJA', NULL),
    ('Configuración de ONU en OLT Harmonic', 3, 30, 'MEDIA', NULL),
    ('Soporte a ONU en OLT Harmonic', 3, 30, 'MEDIA', 'Harmonic'),
    ('Reporte de perdidas de paquetes en celda Movistar', 3, 30, 'MEDIA', 'Movistar'),
    ('AB con Servicio Suspendido', 2, 15, 'MEDIA', 'Sistemas Nacionales'),
    ('Cambio de MAC del router', 1, 10, 'MEDIA', NULL),
    ('Falla de acceso a juegos', 2, 15, 'ALTA', 'WAN'),
    ('Latencia en juegos', 2, 20, 'ALTA', 'WAN'),
    ('Falla por tipo de NAT en juegos', 2, 15, 'ALTA', NULL),
    ('Falla de acceso a servidores correo', 2, 45, 'ALTA', 'Seguridad IP y Cliente'),
    ('Falla de acceso a páginas', 2, 30, 'ALTA', 'WAN'),
    ('Balanceo de OLT', 4, 120, 'MEDIA', 'HE'),
    ('Creación de portchannel', 4, 60, 'MEDIA', 'HE'),
    ('Tarjeta inhibida en OLT', 3, 60, 'ALTA', NULL),
    ('ONUs en discovery de la OLT', 2, 15, 'ALTA', 'Sistemas Nacionales'),
    ('Ejecución de Auditorias 815 por ciudad', 3, 30, 'MEDIA', NULL),
    ('Creación de usuarios 815', 1, 10, 'MEDIA', '815'),
    ('Creación de usuarios OLT', 1, 10, 'MEDIA', NULL),
    ('AB sin servicio Inter Empresa B', 2, 20, 'ALTA', 'Netuno'),
    ('AB sin servicio Empresa B en red Inter', 2, 15, 'ALTA', NULL),
    ('AB con lentitud', 2, 20, 'ALTA', NULL),
    ('Activación y actualización de tarjetas GCOB', 2, 20, 'MEDIA', NULL),
    ('Reportes de puertos bloqueados', 2, 45, 'ALTA', 'Seguridad IP y 815'),
    ('Fallas de conexión a VPN', 2, 45, 'ALTA', 'Seguridad IP y 815'),
    ('Solicitud de Apagado Mac-domain - Eliminacion de Puerto', 2, 15, 'MEDIA', NULL),
    ('Solicitud de Creacion de Mac-domain - Puerto de Balanceo', 3, 25, 'BAJA', 'HE'),
    ('Segmentacion de Nodos en CMTS', 3, 25, 'BAJA', 'HE'),
    ('Liberacion de Disco en BCC', 1, 10, 'MEDIA', NULL),
    ('Liberacion de Bloques de IP en BCC', 3, 30, 'MEDIA', NULL),
    ('Reinicio de Colector en CMTS', 1, 10, 'BAJA', NULL),
    ('Soporte a CM Ranged - DhcpV4Done - NullIP', 2, 20, 'MEDIA', NULL),
    ('Reinicio de tarjeta SCM-RCM en CMTS', 2, 15, 'BAJA', NULL),
    ('Reconfiguración de CMTS', 4, 360, 'BAJA', NULL),
    ('Reinicio de tarjetas US/DS', 2, 15, 'MEDIA', NULL)
)
INSERT INTO "TipoCaso" ("id", "area_codigo", "subgrupo_id", "nombre", "nivel", "minutos_estimados", "frecuencia", "dependencias", "updatedAt")
SELECT gen_random_uuid()::text, a."codigo",
       (SELECT s."id" FROM "Subgrupo" s WHERE s."area_codigo" = a."codigo" AND s."nombre" ILIKE 'soporte%' ORDER BY s."orden" LIMIT 1),
       d."nombre", d."nivel", d."minutos", d."frecuencia", d."dependencias", CURRENT_TIMESTAMP
FROM datos d CROSS JOIN area a
ON CONFLICT ("area_codigo", "nombre") DO NOTHING;

-- WAN. "Corrección de errores de enlaces (Óptica)" venía con nivel 3 y 4 pts: los puntos siguen al nivel (8).
WITH area AS (
    SELECT "codigo" FROM "Area" WHERE "codigo" = 'WAN' OR "nombre" ILIKE 'wan'
    ORDER BY ("codigo" = 'WAN') DESC, "orden" LIMIT 1
), datos ("nombre", "nivel", "minutos", "frecuencia", "dependencias") AS (VALUES
    ('Ampliación de enlaces WAN', 1, 180, 'MEDIA', 'Óptica'),
    ('Ampliación de enlaces metropolitanos', 2, 180, 'MEDIA', 'UN'),
    ('Ampliación de enlaces internacionales (Óptica)', 2, 1440, 'MEDIA', 'Óptica'),
    ('Ampliación de enlaces internacionales (PI)', 2, 1440, 'MEDIA', 'Proveedor internacional'),
    ('Corrección de errores de enlaces (Óptica)', 3, 360, 'MEDIA', 'Óptica'),
    ('Corrección de errores de enlaces (UN)', 2, 360, 'MEDIA', 'UN'),
    ('Corrección de errores de enlaces (PI)', 4, 2880, 'MEDIA', 'Proveedor internacional'),
    ('Movimiento de bloques', 1, 60, 'ALTA', NULL),
    ('Verificación de reportes (FTTH)', 3, 240, 'MEDIA', 'IP-FTTH'),
    ('Verificación de reportes (GC)', 3, 240, 'MEDIA', 'IP-Grandes Cuentas'),
    ('Puesta en producción de equipamiento', 2, 1440, 'MEDIA', 'Ingeniería, Logística, Energía, Óptica, UN'),
    ('Puesta en producción de hub', 2, 1440, 'MEDIA', 'Ingeniería, Logística, Energía, Óptica, UN'),
    ('Configuración de temas de enrutamiento', 3, 240, 'MEDIA', NULL)
)
INSERT INTO "TipoCaso" ("id", "area_codigo", "nombre", "nivel", "minutos_estimados", "frecuencia", "dependencias", "updatedAt")
SELECT gen_random_uuid()::text, a."codigo", d."nombre", d."nivel", d."minutos", d."frecuencia", d."dependencias", CURRENT_TIMESTAMP
FROM datos d CROSS JOIN area a
ON CONFLICT ("area_codigo", "nombre") DO NOTHING;
