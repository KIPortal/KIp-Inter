const express = require('express');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboardRoutes');
const operatorRoutes = require('./routes/operatorRoutes');
const ticketRoutes = require('./routes/ticketRoutes');
const reportRoutes = require('./routes/reportRoutes');
const turnoRoutes = require('./routes/turnoRoutes');
const auditRoutes = require('./routes/auditRoutes');
const adminRoutes = require('./routes/adminRoutes');
const contactRoutes = require('./routes/contactRoutes');
const avisosRoutes = require('./routes/avisosRoutes');
const requireAuth = require('./middlewares/requireAuth');
const { authorizeAdmin } = require('./services/roleService');
const emailIngestionService = require('./services/emailIngestionService');
const { loadStamp } = require('./services/changeStampService');

const app = express();

// Iniciar ingesta de correos vía Graph API
emailIngestionService.iniciarIngesta();

// Registro de jornadas: cierre automático cada día a las 00:05 (Caracas)
require('./services/jornadaRegistroService').programarCierre(require('./config/prisma'));

const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production'
	? null
	: 'local-development-session-secret');

if (!sessionSecret) {
	throw new Error('SESSION_SECRET debe estar configurado en producción');
}

// Detrás de un túnel (cloudflared, ngrok) o un proxy local, confiar en X-Forwarded-Proto
// solo cuando la conexión viene de la misma máquina; así la cookie segura de producción funciona con https.
app.set('trust proxy', 'loopback');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
// Versión de los archivos estáticos: cambia en cada arranque para que el navegador no use JS/CSS viejos
app.locals.v = Date.now().toString(36);
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
	secret: sessionSecret,
	resave: false,
	saveUninitialized: false,
	cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));

// Catálogo de áreas desde la tabla Area (caché de 60 s)
const prisma = require('./config/prisma');
const { refreshAreas } = require('./services/areaCatalog');
app.use((req, res, next) => { refreshAreas(prisma).finally(next); });

// Sello de cambios para la actualización en vivo (public/js/vivo.js)
app.get('/api/cambios', requireAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
        res.json({ success: true, sello: await loadStamp(prisma) });
    } catch (error) {
        res.status(500).json({ success: false, error: 'No se pudo revisar si hay cambios' });
    }
});

app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/', dashboardRoutes);
app.use('/api/operators', operatorRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/turnos', turnoRoutes);
app.use('/reportes', reportRoutes);
app.use('/reports', reportRoutes);
app.use('/contactos', contactRoutes);
app.use('/api/contactos', contactRoutes);
app.use('/api/avisos', avisosRoutes);
app.use('/auditoria', requireAuth, authorizeAdmin, auditRoutes);
app.use('/admin', requireAuth, authorizeAdmin, adminRoutes.page);
app.use('/api/admin', requireAuth, authorizeAdmin, adminRoutes.api);

module.exports = app;