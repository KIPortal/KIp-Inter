-- Buzones por carpeta y papelera de buzones.
-- Una cuenta de correo puede tener varios buzones, uno por carpeta (p. ej. Soporte → FTTx · Soporte,
-- Cabecera → FTTx · Cabecera), con una sola sesión. Eliminar un buzón lo manda a la papelera.

ALTER TABLE "Buzon" ADD COLUMN "carpeta" VARCHAR(120) NOT NULL DEFAULT '',
ADD COLUMN "eliminado_en" TIMESTAMP(3),
ADD COLUMN "motivo_eliminacion" VARCHAR(300);

-- El correo deja de ser único por sí solo: lo es junto con la carpeta
DROP INDEX "Buzon_correo_key";
CREATE UNIQUE INDEX "Buzon_correo_carpeta_key" ON "Buzon"("correo", "carpeta");
