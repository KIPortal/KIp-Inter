const express = require('express');
const ticketController = require('../controllers/ticketController');
const requireAuth = require('../middlewares/requireAuth');
const authorizeRole = require('../middlewares/authorizeRole');

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
router.post('/:ticketCode/claim', authorizeRole('OPERADOR'), ticketController.claimTicket);
router.post('/:ticketCode/pause', authorizeRole('OPERADOR'), ticketController.pauseTicket);
router.post('/:ticketCode/resume', authorizeRole('OPERADOR'), ticketController.resumeTicket);
router.post('/:ticketCode/resolve', authorizeRole('OPERADOR'), ticketController.resolveTicket);
router.patch('/:ticketCode/status', authorizeRole('OPERADOR'), ticketController.updateOperatorStatus);

module.exports = router;