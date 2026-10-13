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
const requireAuth = require('./middlewares/requireAuth');
const authorizeRole = require('./middlewares/authorizeRole');
const emailIngestionService = require('./services/emailIngestionService');

const app = express();

// Iniciar ingesta de correos vía Graph API
emailIngestionService.iniciarIngesta();

const sessionSecret = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production'
	? null
	: 'local-development-session-secret');

if (!sessionSecret) {
	throw new Error('SESSION_SECRET debe estar configurado en producción');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
	secret: sessionSecret,
	resave: false,
	saveUninitialized: false,
	cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' }
}));

app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes);
app.use('/', dashboardRoutes);
app.use('/api/operators', operatorRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/turnos', turnoRoutes);
app.use('/reportes', reportRoutes);
app.use('/reports', reportRoutes);
app.use('/auditoria', requireAuth, authorizeRole('COORDINADOR'), auditRoutes);

// Vista de prueba del rediseño (Fase 1): barra lateral, tema y componentes base.
app.get('/vista-previa', requireAuth, authorizeRole('COORDINADOR'), (req, res) => {
	res.render('vista-previa', { currentUser: req.user });
});

module.exports = app;