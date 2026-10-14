const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const turnoController = require('../controllers/turnoController');
const requireAuth = require('../middlewares/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.get('/dashboard', (req, res) => res.redirect(302, '/'));
router.get('/', dashboardController.renderDashboard);
router.get('/tickets', dashboardController.renderTickets);
router.get('/mi-panel', dashboardController.renderMyPanel);
router.get('/gestion-turno', turnoController.renderTurno);

module.exports = router;