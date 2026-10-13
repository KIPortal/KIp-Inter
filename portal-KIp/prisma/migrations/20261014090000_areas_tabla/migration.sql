-- Áreas como tabla editable + usuarios activables.
-- IMPORTANTE: escrita a mano. El diff automático de Prisma borraría y recrearía
-- las columnas area_designada (perdiendo datos); aquí se convierte el tipo.

-- 1. Tabla de áreas con las 7 originales
CREATE TABLE "Area" (
    "codigo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(60) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Area_pkey" PRIMARY KEY ("codigo")
);

INSERT INTO "Area" ("codigo", "nombre", "orden") VALUES
    ('GENERAL', 'General', 0),
    ('REDES_FTTH', 'Redes FTTH', 1),
    ('TRAFICO_INALAMBRICO', 'Tráfico Inalámbrico', 2),
    ('WAN', 'WAN', 3),
    ('GRANDES_CLIENTES', 'Grandes Clientes', 4),
    ('SEGURIDAD', 'Seguridad', 5),
    ('TELEFONIA', 'Telefonía', 6);

-- 2. User y Ticket: de enum a texto, conservando el valor de cada fila
ALTER TABLE "User" ALTER COLUMN "area_designada" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "area_designada" SET DATA TYPE VARCHAR(40) USING "area_designada"::text;
ALTER TABLE "User" ALTER COLUMN "area_designada" SET DEFAULT 'GENERAL';

ALTER TABLE "Ticket" ALTER COLUMN "area_designada" DROP DEFAULT;
ALTER TABLE "Ticket" ALTER COLUMN "area_designada" SET DATA TYPE VARCHAR(40) USING "area_designada"::text;
ALTER TABLE "Ticket" ALTER COLUMN "area_designada" SET DEFAULT 'GENERAL';

-- 3. Usuarios activables (desactivado = no entra ni recibe tickets)
ALTER TABLE "User" ADD COLUMN "activo" BOOLEAN NOT NULL DEFAULT true;

-- 4. Llaves foráneas y fin del enum
ALTER TABLE "User" ADD CONSTRAINT "User_area_designada_fkey" FOREIGN KEY ("area_designada") REFERENCES "Area"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_area_designada_fkey" FOREIGN KEY ("area_designada") REFERENCES "Area"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Se borra el enum solo si ya ninguna columna lo usa (en algunas bases existe la
-- tabla "BitacoraMessage", fuera del schema de Prisma, que todavía lo usa).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND udt_name = 'AreaDesignada'
    ) THEN
        DROP TYPE "AreaDesignada";
    END IF;
END $$;
