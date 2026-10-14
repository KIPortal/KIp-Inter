-- Subgrupos dentro de un área (FTTx: Soporte y Cabecera)
CREATE TABLE "Subgrupo" (
    "id" TEXT NOT NULL,
    "area_codigo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(60) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subgrupo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subgrupo_area_codigo_nombre_key" ON "Subgrupo"("area_codigo", "nombre");
ALTER TABLE "Subgrupo" ADD CONSTRAINT "Subgrupo_area_codigo_fkey" FOREIGN KEY ("area_codigo") REFERENCES "Area"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Subgrupo" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "User" ADD COLUMN "subgrupo_id" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_subgrupo_id_fkey" FOREIGN KEY ("subgrupo_id") REFERENCES "Subgrupo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Ticket" ADD COLUMN "subgrupo_id" TEXT;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_subgrupo_id_fkey" FOREIGN KEY ("subgrupo_id") REFERENCES "Subgrupo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
