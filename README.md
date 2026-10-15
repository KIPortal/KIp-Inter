# Portal KIp — Operaciones IP

Portal web de tickets y estadísticas del departamento **Operaciones IP** (Inter Telecomunicaciones). Recibe los casos por correo, los reparte entre los operadores, mide la carga de trabajo de cada uno y genera los reportes del área.

**Autor:** Jose Corobo (Jacu) · joseacorobo@gmail.com
**Licencia:** propietaria, todos los derechos reservados. Ver [LICENSE](LICENSE). Este repositorio es privado; tener acceso de lectura no da permiso para copiarlo, publicarlo ni usarlo fuera de él.

## Empezar

La guía para colaboradores explica cómo instalarlo, conectar la base de datos, la arquitectura y cómo se construyeron las partes principales:

**→ [docs/guia-colaborador.md](docs/guia-colaborador.md)**

Resumen rápido (PowerShell, Windows):

```powershell
cd portal-KIp
npm install
Copy-Item .env.example .env      # y llena DATABASE_URL y DIRECT_URL
npx prisma migrate deploy
npx prisma generate
node scripts/crear-admin.js --email=tu@correo.com --nombre="Tu Nombre" --clave=TuClave1
npm run dev                      # http://localhost:3000
```

## Tecnologías

Node.js + Express 5 · Prisma 5 sobre PostgreSQL (Supabase) · vistas EJS · JavaScript sin framework · Tailwind · Apache ECharts · exceljs · Microsoft Graph (ingesta de correos).
