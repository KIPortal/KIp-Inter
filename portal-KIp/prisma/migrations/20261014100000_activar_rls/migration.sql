-- Activa Row Level Security en todas las tablas de public.
-- Sin políticas: cierra el acceso por la API de Supabase (roles anon y authenticated).
-- El portal no se ve afectado: Prisma entra como postgres (dueño de las tablas), que salta RLS.

ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ticket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BitacoraMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Adjunto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HorarioOperador" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardiaSemanal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Traspaso" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TraspasoTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Configuracion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Area" ENABLE ROW LEVEL SECURITY;
