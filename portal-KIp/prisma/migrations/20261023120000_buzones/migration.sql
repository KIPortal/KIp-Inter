-- Varios buzones de correo: cada uno crea sus tickets en un área (y subgrupo).
-- Se configuran en Administración → Buzones. Sin filas, la ingesta sigue con GRAPH_NOC_MAILBOX → General.

-- 1. Catálogo de buzones
CREATE TABLE "Buzon" (
    "id" TEXT NOT NULL,
    "correo" VARCHAR(180) NOT NULL,
    "area_codigo" VARCHAR(40) NOT NULL,
    "subgrupo_id" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "solo_lectura" BOOLEAN NOT NULL DEFAULT false,
    "ultima_revision" TIMESTAMP(3),
    "ultimo_error" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Buzon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Buzon_correo_key" ON "Buzon"("correo");
ALTER TABLE "Buzon" ADD CONSTRAINT "Buzon_area_codigo_fkey" FOREIGN KEY ("area_codigo") REFERENCES "Area"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Buzon" ADD CONSTRAINT "Buzon_subgrupo_id_fkey" FOREIGN KEY ("subgrupo_id") REFERENCES "Subgrupo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Buzon" ENABLE ROW LEVEL SECURITY;

-- 2. Ticket: buzón de origen (la respuesta sale desde él) e id del correo que lo creó
ALTER TABLE "Ticket" ADD COLUMN "buzon_id" TEXT,
ADD COLUMN "correo_id" VARCHAR(250);
CREATE UNIQUE INDEX "Ticket_correo_id_key" ON "Ticket"("correo_id");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_buzon_id_fkey" FOREIGN KEY ("buzon_id") REFERENCES "Buzon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3. Mensaje: id del correo recibido (un correo en copia a dos buzones se guarda una vez)
ALTER TABLE "Mensaje" ADD COLUMN "correo_id" VARCHAR(250);
CREATE UNIQUE INDEX "Mensaje_correo_id_key" ON "Mensaje"("correo_id");
