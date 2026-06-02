/**
 * Controller legacy — Webhooks PawaPay
 * Wrapper rétro-compatible. Délègue au module `payments/webhooks/`.
 */

const depositWebhook = require('../payments/webhooks/pawapay-deposit.webhook');
const payoutWebhook = require('../payments/webhooks/pawapay-payout.webhook');
const refundWebhook = require('../payments/webhooks/pawapay-refund.webhook');
const { getDb } = require('../config/db');
const { info, warn, error: logError } = require('../utils/logger');

function getSignature(req) {
  return req.headers['x-pawapay-signature'] || req.headers['x-signature'];
}

async function handleDeposit(req, res) {
  try {
    const db = getDb();
    const result = await depositWebhook.handle(db, req.body || {}, {
      rawBody: req.rawBody,
      signature: getSignature(req),
    });
    return res.status(200).json({ ok: true, event: 'deposit', ...result });
  } catch (err) {
    logError({ msg: 'legacy_pawapay_deposit_error', error: err.message });
    return res.status(200).json({ ok: true, event: 'deposit', error: 'handler_failed' });
  }
}

async function handlePayout(req, res) {
  try {
    const db = getDb();
    const result = await payoutWebhook.handle(db, req.body || {}, {
      rawBody: req.rawBody,
      signature: getSignature(req),
    });
    return res.status(200).json({ ok: true, event: 'payout', ...result });
  } catch (err) {
    logError({ msg: 'legacy_pawapay_payout_error', error: err.message });
    return res.status(200).json({ ok: true, event: 'payout', error: 'handler_failed' });
  }
}

async function handleRefund(req, res) {
  try {
    const db = getDb();
    const result = await refundWebhook.handle(db, req.body || {}, {
      rawBody: req.rawBody,
      signature: getSignature(req),
    });
    return res.status(200).json({ ok: true, event: 'refund', ...result });
  } catch (err) {
    logError({ msg: 'legacy_pawapay_refund_error', error: err.message });
    return res.status(200).json({ ok: true, event: 'refund', error: 'handler_failed' });
  }
}

module.exports = {
  handleDeposit,
  handlePayout,
  handleRefund,
};
