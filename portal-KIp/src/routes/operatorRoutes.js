const express = require('express');
const operatorController = require('../controllers/operatorController');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRole = require('../middlewares/authorizeRole');

const router = express.Router();

router.use(requireAuth, authorizeRole('OPERADOR'));

router.patch('/:operatorId/status', operatorController.updateStatus);

module.exports = router;