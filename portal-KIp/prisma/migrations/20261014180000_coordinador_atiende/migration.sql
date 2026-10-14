-- Coordinador que también atiende tickets: puede tomarlos, trabajarlos en "Mi panel"
-- y aparece con los operadores en carga, sugerencias, turnos y reportes.
ALTER TABLE "User" ADD COLUMN "atiende_tickets" BOOLEAN NOT NULL DEFAULT false;
