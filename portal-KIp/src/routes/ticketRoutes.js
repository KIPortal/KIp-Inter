const express = require('express');
const ticketController = require('../controllers/ticketController');
const requireAuth = require('../middlewares/requireAuth');
const { authorizeWorker, authorizeSupervisor } = require('../services/roleService');
const { limitarAlArea } = require('../middlewares/areaScope');
const conversationController = require('../controllers/conversationController');
const upload = require('../middlewares/upload');

// Adjuntos de la conversación: un error de subida responde en JSON, no en HTML
const subirAdjuntos = (req, res, next) => upload.any()(req, res, err => (
    err ? res.status(400).json({ success: false, error: 'No se pudieron subir los adjuntos (máximo 25 MB por archivo)' }) : next()
));

const router = express.Router();

router.use(requireAuth);

router.post('/', authorizeSupervisor, limitarAlArea, ticketController.createTicket);
router.post('/assign', authorizeSupervisor, limitarAlArea, ticketController.assignTicket);
router.post('/unassign', authorizeSupervisor, limitarAlArea, ticketController.unassignTicket);
router.post('/batch-assign', authorizeSupervisor, limitarAlArea, ticketController.batchAssignTickets);
router.post('/handoff', authorizeSupervisor, limitarAlArea, ticketController.handoffTickets);
router.get('/handoff/actual', authorizeSupervisor, limitarAlArea, ticketController.getActiveHandoff);
router.post('/handoff/:id/atendido', authorizeSupervisor, limitarAlArea, ticketController.closeHandoff);
router.get('/trash', authorizeSupervisor, limitarAlArea, ticketController.listTrash);
router.get('/:ticketCode/history', authorizeSupervisor, limitarAlArea, ticketController.getTicketHistory);
router.post('/:ticketCode/close', authorizeSupervisor, limitarAlArea, ticketController.closeTicket);
router.patch('/:ticketCode', authorizeSupervisor, limitarAlArea, ticketController.editTicket);
router.delete('/:ticketCode', authorizeSupervisor, limitarAlArea, ticketController.deleteTicket);
router.post('/:ticketCode/restore', authorizeSupervisor, limitarAlArea, ticketController.restoreTicket);
router.post('/:ticketCode/claim', authorizeWorker, limitarAlArea, ticketController.claimTicket);
router.post('/:ticketCode/pause', authorizeWorker, ticketController.pauseTicket);
router.post('/:ticketCode/resume', authorizeWorker, ticketController.resumeTicket);
router.post('/:ticketCode/resolve', authorizeWorker, ticketController.resolveTicket);
router.get('/:ticketCode/conversacion', conversationController.getConversation);
router.post('/:ticketCode/mensajes', authorizeWorker, subirAdjuntos, conversationController.postMessage);
router.patch('/:ticketCode/status', authorizeWorker, ticketController.updateOperatorStatus);

module.exports = router;