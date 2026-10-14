const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const requireAuth = require('../middlewares/requireAuth');
const { authorizeSupervisor } = require('../services/roleService');

router.use(requireAuth);
router.get('/', reportController.renderReportes);
// Reporte por periodo: ?periodo=jornada|semana|mes|especifica&fecha=AAAA-MM-DD&area=WAN
router.get('/data', authorizeSupervisor, reportController.getPeriodData);
router.get('/excel', authorizeSupervisor, reportController.downloadExcel);

module.exports = router;
