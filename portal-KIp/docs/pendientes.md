
## Flujo limpio y simulación (hecho)
- Se eliminó `prisma/seed.js`. Primer coordinador: `node scripts/crear-admin.js --email=... --nombre="..." --clave=...`.
- Jornada simulada: `node scripts/simular-jornada.js --fecha=AAAA-MM-DD --tickets=40`; limpieza: `node scripts/limpiar-simulacion.js --confirmar` (solo borra SIM-xxx y @demo.local).
