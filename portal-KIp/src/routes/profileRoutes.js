const express = require('express');
const profileController = require('../controllers/profileController');
const requireAuth = require('../middlewares/requireAuth');
const { FOTO_MAX_BYTES } = require('../services/profileService');

// La foto llega como el archivo tal cual (fetch con Content-Type image/*); el tipo real se revisa por sus bytes
const leerFoto = express.raw({ type: 'image/*', limit: FOTO_MAX_BYTES });
const fotoMuyGrande = (err, req, res, next) => (err && err.type === 'entity.too.large'
    ? res.status(413).json({ success: false, error: 'La foto pesa más de 2 MB' })
    : next(err));

// /perfil: página y fotos (las fotos solo se ven con sesión iniciada)
const page = express.Router();
page.use(requireAuth);
page.get('/', profileController.renderPerfil);
page.get('/foto/:archivo', profileController.serveFoto);

// /api/perfil: cambios propios
const api = express.Router();
api.use(requireAuth);
api.put('/foto', leerFoto, fotoMuyGrande, profileController.uploadFoto);
api.delete('/foto', profileController.deleteFoto);
api.post('/clave', profileController.changePassword);

module.exports = { page, api };
