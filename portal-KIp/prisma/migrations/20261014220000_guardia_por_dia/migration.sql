-- Guardia por día (antes: por semana completa)
CREATE TABLE "GuardiaDia" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardiaDia_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GuardiaDia_fecha_idx" ON "GuardiaDia"("fecha");
CREATE UNIQUE INDEX "GuardiaDia_userId_fecha_key" ON "GuardiaDia"("userId", "fecha");

ALTER TABLE "GuardiaDia" ADD CONSTRAINT "GuardiaDia_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Igual que las demás tablas: solo el servidor (Prisma) la usa
ALTER TABLE "GuardiaDia" ENABLE ROW LEVEL SECURITY;

-- Las guardias semanales ya definidas pasan a sus 7 días
INSERT INTO "GuardiaDia" ("id", "userId", "fecha")
SELECT gen_random_uuid()::text, g."userId", g."semana_inicio" + (d * INTERVAL '1 day')
FROM "GuardiaSemanal" g CROSS JOIN generate_series(0, 6) AS d
ON CONFLICT ("userId", "fecha") DO NOTHING;
