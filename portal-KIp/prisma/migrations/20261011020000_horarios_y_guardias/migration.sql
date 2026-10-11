-- CreateTable
CREATE TABLE "HorarioOperador" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dias" INTEGER[],
    "hora_inicio" VARCHAR(5) NOT NULL DEFAULT '08:00',
    "hora_fin" VARCHAR(5) NOT NULL DEFAULT '17:00',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HorarioOperador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuardiaSemanal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "semana_inicio" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardiaSemanal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HorarioOperador_userId_key" ON "HorarioOperador"("userId");
CREATE INDEX "GuardiaSemanal_semana_inicio_idx" ON "GuardiaSemanal"("semana_inicio");
CREATE UNIQUE INDEX "GuardiaSemanal_userId_semana_inicio_key" ON "GuardiaSemanal"("userId", "semana_inicio");

-- AddForeignKey
ALTER TABLE "HorarioOperador" ADD CONSTRAINT "HorarioOperador_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuardiaSemanal" ADD CONSTRAINT "GuardiaSemanal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
