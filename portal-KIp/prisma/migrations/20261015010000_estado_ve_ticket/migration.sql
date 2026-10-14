-- Estado de Venezuela del ticket (código ISO sin guion, p. ej. VEA = Distrito Capital).
-- Opcional: alimenta el mapa de "Distribución territorial" del Dashboard.
ALTER TABLE "Ticket" ADD COLUMN "estado_ve" VARCHAR(3);
