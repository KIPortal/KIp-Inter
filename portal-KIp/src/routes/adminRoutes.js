const express = require('express');
const adminController = require('../controllers/adminController');

// Página: /admin · API: /api/admin (ambas montadas con requireAuth + COORDINADOR en app.js)
const page = express.Router();
page.get('/', adminController.renderAdmin);

const api = express.Router();
api.put('/config', adminController.saveConfig);
api.post('/preview', adminController.preview);

module.exports = { page, api };
