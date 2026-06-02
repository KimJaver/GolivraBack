/**
 * Controller — Paiement client
 * Routes : POST /api/orders/:orderId/pay, GET /api/orders/:orderId/payment-status
 */

const { getDb } = require('../../config/db');
const { createHttpError, requireFields } = require('../../utils/http');
const paymentService = require('../services/payment.service');
const paymentRepo = require('../repositories/payment.repository');
const { normalizePaymentRequest, paymentResponse } = require('../dto/payment.dto');

/**
 * POST /api/orders/:orderId/pay
 * Initie le paiement d'une commande (idempotent).
 */
async function payOrder(req, res, next) {
  try {
    const { orderId } = req.params;
    const payload = normalizePaymentRequest(req.body || {});
    const db = getDb();
    const result = await paymentService.initiate(db, orderId, req.auth.userId, payload);

    if (!result.dejaValide) {
      try {
        const { notifyPaymentConfirmed } = require('../../services/order-notify.service');
        await notifyPaymentConfirmed(db, result.commande.id, req.auth.userId);
      } catch (err) {
        // log only — la notification ne doit pas faire échouer le paiement
        require('../../utils/logger').warn({ msg: 'payOrder_notify', error: err.message });
      }
    }

    return res.json({
      ok: true,
      deja_valide: result.dejaValide,
      simulation: result.simulation,
      payment_mode: paymentService.PAYMENT_MODE,
      test_mode: paymentService.isTestPaymentMode(),
      paiement: paymentResponse(result.paiement),
      commande_id: result.commande.id,
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/orders/:orderId/payment-status
 * Statut du dernier paiement pour une commande.
 */
async function getPaymentStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const db = getDb();
    const paiement = await paymentRepo.findLatestForCommande(db, orderId);
    if (!paiement) return res.status(404).json({ code: 'PAIEMENT_INTROUVABLE' });
    return res.json(paymentResponse(paiement));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/payments/mode
 * Mode de paiement (test / live) et providers supportés.
 */
function getPaymentMode(req, res) {
  return res.json({
    mode: paymentService.PAYMENT_MODE,
    test_mode: paymentService.isTestPaymentMode(),
    providers: ['airtel_money', 'mtn_money', 'portefeuille_golivra'],
    pays_supportes: ['CG'],
  });
}

module.exports = { payOrder, getPaymentStatus, getPaymentMode };
