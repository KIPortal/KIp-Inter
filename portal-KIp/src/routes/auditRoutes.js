const express = require('express');
const router = express.Router();
const auditController = require('../controllers/auditController');

router.get('/', auditController.getAuditLogs);
router.get('/exportar', auditController.exportAuditCsv);

module.exports = router;
