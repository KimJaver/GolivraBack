/**
 * Routes — Paiement (côté commande client)
 * Base : /api/orders/:orderId/pay
 */

const express = require('express');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { requireRoles } = require('../../middlewares/role.middleware');
const { payOrder, getPaymentStatus } = require('../controllers/payment.controller');

const router = express.Router();

const clientOnly = requireRoles(['client', 'admin']);

router.post('/:orderId/pay', authMiddleware, clientOnly, payOrder);
router.get('/:orderId/payment-status', authMiddleware, clientOnly, getPaymentStatus);

module.exports = router;
