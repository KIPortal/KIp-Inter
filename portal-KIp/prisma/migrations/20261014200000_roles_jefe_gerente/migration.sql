-- Roles Jefe de área y Gerente, y teléfono de contacto de cada usuario
ALTER TYPE "Rol" ADD VALUE IF NOT EXISTS 'JEFE';
ALTER TYPE "Rol" ADD VALUE IF NOT EXISTS 'GERENTE';

ALTER TABLE "User" ADD COLUMN "telefono" VARCHAR(40);
