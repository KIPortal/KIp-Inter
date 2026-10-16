
## Flujo limpio y simulación (hecho)
- Se eliminó `prisma/seed.js`. Primer coordinador: `node scripts/crear-admin.js --email=... --nombre="..." --clave=...`.
- Jornada simulada: `node scripts/simular-jornada.js --fecha=AAAA-MM-DD --tickets=40`; limpieza: `node scripts/limpiar-simulacion.js --confirmar` (solo borra SIM-xxx y @demo.local).

## Mi perfil (hecho, 2026-10-16)
- `/perfil`: cada quien cambia su foto, su teléfono y su clave (pide la actual). Nombre, correo, rol, área y subgrupo siguen en Administración.
- Fotos en `portal-KIp/fotos-perfil/` (no versionado; `FOTOS_DIR` para otra carpeta): JPG/PNG/WebP revisados por sus bytes, máx. 2 MB, se recortan a 512 px en el navegador. Solo se sirven con sesión iniciada.
- Pendiente para `feat/seguridad-login`: `profileController.changePassword` compara y guarda la clave tal cual, igual que el login; al fusionar, cifrarla ahí también.
