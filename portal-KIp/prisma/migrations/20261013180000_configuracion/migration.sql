-- Configuración de Administración (reglas, avisos y plantillas)

-- CreateTable
CREATE TABLE "Configuracion" (
    "clave" VARCHAR(40) NOT NULL,
    "valor" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Configuracion_pkey" PRIMARY KEY ("clave")
);
