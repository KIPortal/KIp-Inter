-- Prioridad sugerida (P1/P2/P3) por palabras clave al llegar el correo; el operador la confirma al tomarlo
ALTER TABLE "Ticket" ADD COLUMN "prioridad_sugerida" VARCHAR(2);
