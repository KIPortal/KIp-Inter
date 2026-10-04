-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('COORDINADOR', 'OPERADOR');

-- CreateEnum
CREATE TYPE "EstadoOperativo" AS ENUM ('DISPONIBLE', 'EN_TERRENO', 'AUSENTE');

-- CreateEnum
CREATE TYPE "OrigenIngesta" AS ENUM ('CORREO', 'LLAMADA', 'JEFATURA', 'COORDINADOR');

-- CreateEnum
CREATE TYPE "EstadoTicket" AS ENUM ('NUEVO', 'EN_PROGRESO', 'EN_ESPERA_TERCEROS', 'CERRADO');

-- CreateEnum
CREATE TYPE "AreaDesignada" AS ENUM ('GENERAL', 'REDES_FTTH', 'TRAFICO_INALAMBRICO', 'WAN', 'GRANDES_CLIENTES', 'SEGURIDAD', 'TELEFONIA');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'OPERADOR',
    "area_designada" "AreaDesignada" NOT NULL DEFAULT 'GENERAL',
    "estado_operativo" "EstadoOperativo" NOT NULL DEFAULT 'DISPONIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "codigo_incidencia" TEXT NOT NULL,
    "asunto" TEXT NOT NULL,
    "descripcion" TEXT,
    "remitente" VARCHAR(180),
    "estado_actual" "EstadoTicket" NOT NULL DEFAULT 'NUEVO',
    "puntos_complejidad" INTEGER NOT NULL DEFAULT 0,
    "origen_ingesta" "OrigenIngesta" NOT NULL DEFAULT 'CORREO',
    "area_designada" "AreaDesignada" NOT NULL DEFAULT 'GENERAL',
    "creado_por_id" TEXT,
    "asignado_a_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resueltoEn" TIMESTAMP(3),
    "fecha_asignacion" TIMESTAMP(3),
    "fecha_cierre" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_codigo_incidencia_key" ON "Ticket"("codigo_incidencia");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_asignado_a_id_fkey" FOREIGN KEY ("asignado_a_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
