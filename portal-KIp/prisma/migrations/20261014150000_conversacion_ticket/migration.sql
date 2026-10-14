-- Conversación del ticket: correos del cliente, respuestas del operador y notas internas

-- CreateEnum
CREATE TYPE "TipoMensaje" AS ENUM ('ENTRANTE', 'SALIENTE', 'NOTA');

-- CreateTable
CREATE TABLE "Mensaje" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tipo" "TipoMensaje" NOT NULL,
    "texto" TEXT NOT NULL,
    "autor_id" TEXT,
    "de" VARCHAR(180),
    "para" VARCHAR(180),
    "enviado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Mensaje_ticketId_createdAt_idx" ON "Mensaje"("ticketId", "createdAt");

-- AddForeignKey
ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Adjuntos de un mensaje (nulo = adjunto del correo que abrió el ticket)
ALTER TABLE "Adjunto" ADD COLUMN "mensajeId" TEXT;
ALTER TABLE "Adjunto" ADD CONSTRAINT "Adjunto_mensajeId_fkey" FOREIGN KEY ("mensajeId") REFERENCES "Mensaje"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Igual que el resto de tablas: sin acceso por la API de Supabase
ALTER TABLE "Mensaje" ENABLE ROW LEVEL SECURITY;
