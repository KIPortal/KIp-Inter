const express = require('express');
const adminController = require('../controllers/adminController');

// Página: /admin · API: /api/admin (ambas montadas con requireAuth + authorizeAdmin en app.js)
const page = express.Router();
page.get('/', adminController.renderAdmin);

const api = express.Router();
api.put('/config', adminController.saveConfig);
api.post('/preview', adminController.preview);
api.post('/usuarios', adminController.createUser);
api.patch('/usuarios/:id', adminController.updateUser);
api.post('/areas', adminController.createArea);
api.patch('/areas/:codigo', adminController.updateArea);
api.post('/areas/:codigo/subgrupos', adminController.createSubgrupo);
api.patch('/subgrupos/:id', adminController.updateSubgrupo);
api.post('/tipos-caso', adminController.createTipoCaso);
api.patch('/tipos-caso/:id', adminController.updateTipoCaso);

module.exports = { page, api };
