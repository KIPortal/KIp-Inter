const express = require('express');
const router = express.Router();
const turnoController = require('../controllers/turnoController');
const requireAuth = require('../middlewares/requireAuth');
const { authorizeSupervisor } = require('../services/roleService');

router.use(requireAuth);
router.use(authorizeSupervisor);
router.get('/', turnoController.getTurnos);
router.put('/guardia', turnoController.setGuardia);
router.put('/horario/:operatorId', turnoController.setHorario);

module.exports = router;
