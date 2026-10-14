const express = require('express');
const operatorController = require('../controllers/operatorController');
const requireAuth = require('../middlewares/requireAuth');
const { authorizeWorker } = require('../services/roleService');

const router = express.Router();

router.use(requireAuth, authorizeWorker);

router.patch('/:operatorId/status', operatorController.updateStatus);

module.exports = router;