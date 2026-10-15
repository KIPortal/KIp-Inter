-- Registro de jornadas: foto diaria al cierre + ruta del Excel guardado
CREATE TABLE "RegistroJornada" (
    "fecha" VARCHAR(10) NOT NULL,
    "datos" JSONB NOT NULL,
    "resumen" JSONB NOT NULL,
    "archivo" TEXT,
    "origen" VARCHAR(12) NOT NULL,
    "cerradoPor" VARCHAR(120),
    "cerradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistroJornada_pkey" PRIMARY KEY ("fecha")
);

ALTER TABLE "RegistroJornada" ENABLE ROW LEVEL SECURITY;
