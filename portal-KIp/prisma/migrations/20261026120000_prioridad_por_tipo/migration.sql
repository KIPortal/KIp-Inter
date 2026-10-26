-- Prioridad por tipo de caso y subida de prioridad por tiempo sin asignar.

-- 1. Cada tipo de caso puede traer su prioridad (P1/P2/P3); null = la elige quien lo toma
ALTER TABLE "TipoCaso" ADD COLUMN "prioridad" VARCHAR(2);

-- 2. Última vez que la prioridad del ticket subió sola por estar sin asignar
--    (el tiempo para el siguiente escalón se cuenta desde aquí)
ALTER TABLE "Ticket" ADD COLUMN "prioridad_subida_en" TIMESTAMP(3);
