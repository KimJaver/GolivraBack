const express = require('express');
const {
  handleDeposit,
  handlePayout,
  handleRefund,
} = require('../controllers/pawapay-webhook.controller');

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

router.post('/deposits', rawJsonParser, async (req, res, next) => {
  try {
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
    return await handleDeposit(req, res);
  } catch (err) {
    return next(err);
  }
});

router.post('/payments', rawJsonParser, async (req, res, next) => {
  try {
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
    return await handlePayout(req, res);
  } catch (err) {
    return next(err);
  }
});

router.post('/refunds', rawJsonParser, async (req, res, next) => {
  try {
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
    return await handleRefund(req, res);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
