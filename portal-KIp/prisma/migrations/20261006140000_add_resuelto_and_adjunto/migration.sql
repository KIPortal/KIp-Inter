-- AlterEnum
ALTER TYPE "EstadoTicket" ADD VALUE 'RESUELTO';

-- CreateTable
CREATE TABLE "Adjunto" (
    "id" TEXT NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "nombre_archivo" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "mimetype" TEXT,
    "peso" INTEGER,
    "ticketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Adjunto_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Adjunto" ADD CONSTRAINT "Adjunto_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
