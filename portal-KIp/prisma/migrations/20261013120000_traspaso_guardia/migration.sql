-- Traspaso a guardia: lote aparte, sin reasignar los tickets

-- CreateTable
CREATE TABLE "Traspaso" (
    "id" TEXT NOT NULL,
    "nota" TEXT NOT NULL,
    "semana_inicio" TIMESTAMP(3) NOT NULL,
    "creado_por_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerrado_en" TIMESTAMP(3),

    CONSTRAINT "Traspaso_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraspasoTicket" (
    "traspasoId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "estado_al_pasar" "EstadoTicket" NOT NULL,
    "operador_al_pasar" VARCHAR(120),

    CONSTRAINT "TraspasoTicket_pkey" PRIMARY KEY ("traspasoId","ticketId")
);

-- CreateIndex
CREATE INDEX "Traspaso_createdAt_idx" ON "Traspaso"("createdAt");
CREATE INDEX "TraspasoTicket_ticketId_idx" ON "TraspasoTicket"("ticketId");

-- AddForeignKey
ALTER TABLE "Traspaso" ADD CONSTRAINT "Traspaso_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TraspasoTicket" ADD CONSTRAINT "TraspasoTicket_traspasoId_fkey" FOREIGN KEY ("traspasoId") REFERENCES "Traspaso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TraspasoTicket" ADD CONSTRAINT "TraspasoTicket_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
