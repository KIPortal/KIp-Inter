const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const requireAuth = require('../middlewares/requireAuth');

const router = express.Router();

router.use(requireAuth);

router.get('/dashboard', (req, res) => res.redirect(302, '/'));
router.get('/', dashboardController.renderDashboard);
router.get('/gestion-turno', dashboardController.redirectToShiftSection);

module.exports = router;