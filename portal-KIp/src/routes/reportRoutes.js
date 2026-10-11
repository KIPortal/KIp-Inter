const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const requireAuth = require('../middlewares/requireAuth');

router.use(requireAuth);
router.get('/', reportController.getReports);

module.exports = router;
