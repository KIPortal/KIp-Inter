-- Índices para las consultas más frecuentes (auditoría de tiempos de carga).
-- Solo agregan índices: no cambian datos ni columnas.

-- Carga activa por operador (Dashboard, Tickets, Turno, Mi panel)
CREATE INDEX IF NOT EXISTS "Ticket_asignado_a_id_estado_actual_idx" ON "Ticket"("asignado_a_id", "estado_actual");
-- Cola del área y conteos por estado
CREATE INDEX IF NOT EXISTS "Ticket_estado_actual_area_designada_idx" ON "Ticket"("estado_actual", "area_designada");
-- Ventanas por fecha (Dashboard, cola, Reportes, registro de jornadas)
CREATE INDEX IF NOT EXISTS "Ticket_createdAt_idx" ON "Ticket"("createdAt");
CREATE INDEX IF NOT EXISTS "Ticket_resueltoEn_idx" ON "Ticket"("resueltoEn");
CREATE INDEX IF NOT EXISTS "Ticket_fecha_cierre_idx" ON "Ticket"("fecha_cierre");
CREATE INDEX IF NOT EXISTS "Ticket_fecha_asignacion_idx" ON "Ticket"("fecha_asignacion");
-- Sello de /api/cambios (máximo de updatedAt)
CREATE INDEX IF NOT EXISTS "Ticket_updatedAt_idx" ON "Ticket"("updatedAt");

-- Historial de un ticket y Auditoría del día
CREATE INDEX IF NOT EXISTS "AuditLog_ticketId_createdAt_idx" ON "AuditLog"("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- Adjuntos de un ticket o de un mensaje
CREATE INDEX IF NOT EXISTS "Adjunto_ticketId_idx" ON "Adjunto"("ticketId");
CREATE INDEX IF NOT EXISTS "Adjunto_mensajeId_idx" ON "Adjunto"("mensajeId");
