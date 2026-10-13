const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRole = require('../middlewares/authorizeRole');

router.use(requireAuth);
// Vista nueva (rediseño); getReports + reports.ejs quedan sin uso hasta borrarlos en la Fase 8
router.get('/', reportController.renderReportes);
// Reporte por periodo: ?periodo=jornada|semana|mes|especifica&fecha=AAAA-MM-DD&area=WAN
router.get('/data', authorizeRole('COORDINADOR'), reportController.getPeriodData);
router.get('/excel', authorizeRole('COORDINADOR'), reportController.downloadExcel);

module.exports = router;
