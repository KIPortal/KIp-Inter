const express = require('express');
const session = require('express-session');
const path = require('path');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboardRoutes');
const operatorRoutes = require('./routes/operatorRoutes');
const ticketRoutes = require('./routes/ticketRoutes');

const app = express();
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

module.exports = app;