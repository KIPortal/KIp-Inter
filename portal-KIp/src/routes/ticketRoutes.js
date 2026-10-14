const express = require('express');
const ticketController = require('../controllers/ticketController');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRole = require('../middlewares/authorizeRole');
const { authorizeWorker } = require('../services/roleService');
const conversationController = require('../controllers/conversationController');
const upload = require('../middlewares/upload');

// Adjuntos de la conversación: un error de subida responde en JSON, no en HTML
const subirAdjuntos = (req, res, next) => upload.any()(req, res, err => (
    err ? res.status(400).json({ success: false, error: 'No se pudieron subir los adjuntos (máximo 25 MB por archivo)' }) : next()
));

const router = express.Router();

router.use(requireAuth);

router.post('/', authorizeRole('COORDINADOR'), ticketController.createTicket);
router.post('/assign', authorizeRole('COORDINADOR'), ticketController.assignTicket);
router.post('/unassign', authorizeRole('COORDINADOR'), ticketController.unassignTicket);
router.post('/batch-assign', authorizeRole('COORDINADOR'), ticketController.batchAssignTickets);
router.post('/handoff', authorizeRole('COORDINADOR'), ticketController.handoffTickets);
router.get('/handoff/actual', authorizeRole('COORDINADOR'), ticketController.getActiveHandoff);
router.post('/handoff/:id/atendido', authorizeRole('COORDINADOR'), ticketController.closeHandoff);
router.get('/trash', authorizeRole('COORDINADOR'), ticketController.listTrash);
router.get('/:ticketCode/history', authorizeRole('COORDINADOR'), ticketController.getTicketHistory);
router.post('/:ticketCode/close', authorizeRole('COORDINADOR'), ticketController.closeTicket);
router.patch('/:ticketCode', authorizeRole('COORDINADOR'), ticketController.editTicket);
router.delete('/:ticketCode', authorizeRole('COORDINADOR'), ticketController.deleteTicket);
router.post('/:ticketCode/restore', authorizeRole('COORDINADOR'), ticketController.restoreTicket);
router.post('/:ticketCode/claim', authorizeWorker, ticketController.claimTicket);
router.post('/:ticketCode/pause', authorizeWorker, ticketController.pauseTicket);
router.post('/:ticketCode/resume', authorizeWorker, ticketController.resumeTicket);
router.post('/:ticketCode/resolve', authorizeWorker, ticketController.resolveTicket);
router.get('/:ticketCode/conversacion', conversationController.getConversation);
router.post('/:ticketCode/mensajes', authorizeWorker, subirAdjuntos, conversationController.postMessage);
router.patch('/:ticketCode/status', authorizeWorker, ticketController.updateOperatorStatus);

module.exports = router;