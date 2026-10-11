const express = require('express');
const router = express.Router();
const bitacoraController = require('../controllers/bitacoraController');
const requireAuth = require('../middlewares/requireAuth');

// Vistas
router.get('/bitacora', requireAuth, bitacoraController.renderBitacora);

// API
router.get('/api/bitacora', requireAuth, bitacoraController.getMessages);
router.post('/api/bitacora', requireAuth, bitacoraController.postMessage);

module.exports = router;
