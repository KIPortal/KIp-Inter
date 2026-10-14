const express = require('express');
const contactController = require('../controllers/contactController');
const requireAuth = require('../middlewares/requireAuth');

const router = express.Router();

router.use(requireAuth);
router.get('/', contactController.renderContactos);
router.patch('/yo', contactController.updateMyPhone);

module.exports = router;
