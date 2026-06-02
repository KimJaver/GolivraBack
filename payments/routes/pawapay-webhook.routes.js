/**
 * Routes — Webhooks PawaPay
 * /webhooks/pawapay/deposits
 * /webhooks/pawapay/payments (payouts)
 * /webhooks/pawapay/refunds
 */

const express = require('express');
const { getDb } = require('../../config/db');
const depositWebhook = require('../webhooks/pawapay-deposit.webhook');
const payoutWebhook = require('../webhooks/pawapay-payout.webhook');
const refundWebhook = require('../webhooks/pawapay-refund.webhook');

const router = express.Router();

function captureRawJson(req, _res, buf) {
  if (buf && buf.length) {
    req.rawBody = buf.toString('utf8');
  }
}

const rawJsonParser = express.raw({
  type: '*/*',
  limit: '256kb',
  verify: captureRawJson,
});

function parseBody(req) {
  if (req.body && req.body.length) {
    const txt = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
    try {
      req.body = JSON.parse(txt);
    } catch {
      req.body = {};
    }
  } else {
    req.body = {};
  }
}

router.post('/deposits', rawJsonParser, async (req, res, next) => {
  try {
    parseBody(req);
    const db = getDb();
    const result = await depositWebhook.handle(db, req.body, {
      rawBody: req.rawBody,
      signature: req.headers['x-pawapay-signature'] || req.headers['x-signature'],
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

router.post('/payments', rawJsonParser, async (req, res, next) => {
  try {
    parseBody(req);
    const db = getDb();
    const result = await payoutWebhook.handle(db, req.body, {
      rawBody: req.rawBody,
      signature: req.headers['x-pawapay-signature'] || req.headers['x-signature'],
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

router.post('/refunds', rawJsonParser, async (req, res, next) => {
  try {
    parseBody(req);
    const db = getDb();
    const result = await refundWebhook.handle(db, req.body, {
      rawBody: req.rawBody,
      signature: req.headers['x-pawapay-signature'] || req.headers['x-signature'],
    });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
