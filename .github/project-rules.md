Contexto del Proyecto
Estamos desarrollando el Portal Web de Operaciones IP (NOC) para centralizar la gestión de tickets, telemetría y flujo de trabajo. La arquitectura es UI-First.

Stack Tecnológico Estricto

Frontend: HTML5, EJS (renderizado desde servidor), TailwindCSS.

Diseño: Interfaz "Telco Industrial" nativa en modo oscuro. Efectos liquid-glass y UI basada estrictamente en los componentes de MacOS 27.

Backend: Node.js, Express.js.

Base de Datos y ORM: Supabase (PostgreSQL) y Prisma.

Interactividad: Fetch API (Vanilla JS) y Supabase Realtime (WebSockets).

Reglas Inquebrantables

Single Source of Truth UI: Todos los assets, estilos de componentes MacOS 27 y ejemplos funcionales residen EXCLUSIVAMENTE en views/components/assets. No inventes CSS puro; usa Tailwind y reutiliza estos componentes.

Lógica Desacoplada: Las rutas de Express deben ser limpias. La lógica de negocio (como calcular puntos DERS) va en controladores separados. Las consultas a la BD se hacen 100% mediante Prisma.

Seguridad (RBAC): Toda ruta debe validar si el rol (Coordinador u Operador) tiene permisos para ejecutar la acción.

Fases de Ejecución Secuencial

Paso 1: Implementar Login (reutilizando HTML anterior) conectado a Express y validando usuarios contra Prisma/Supabase.

Paso 2: Maquetar y conectar el Dashboard General (vista Coordinador).

Paso 3: Maquetar y conectar la Sesión de Operador (vista filtrada) integrando Supabase Realtime para notificaciones de asignación.

Paso 4: Automatizar ingesta de correos (Microsoft Graph API + node-cron).

Paso 5: Desarrollar panel de Reportes, Auditoría y métricas DERS.

Instrucción actual: Inicia la ejecución del Paso 1. Adapta la vista del login existente a una plantilla EJS, configura la ruta POST en Express para autenticar contra la tabla User de Prisma, y genera una sesión activa.