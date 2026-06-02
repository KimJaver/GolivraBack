/**
 * Webhook PawaPay — payout (retrait)
 *
 * Événements : COMPLETED, FAILED, REJECTED, EXPIRED.
 * Le payout est lié à un `withdrawals` via `payoutId`.
 */

const crypto = require('crypto');
const withdrawalRepo = require('../repositories/withdrawal.repository');
const withdrawalService = require('../services/withdrawal.service');
const paymentRepo = require('../repositories/payment.repository');
const { pickString, isSuccessStatus, isFailedStatus, isProcessingStatus, extractPawapayId, extractMetadata } = require('../dto/webhook.dto');
const { info: logInfo, warn: logWarn, error: logError } = require('../../utils/logger');

const WEBHOOK_SECRET = process.env.PAWAPAY_WEBHOOK_SECRET;

function verifySignature(rawBody, signatureHeader) {
  if (!WEBHOOK_SECRET) return { ok: true, skipped: true };
  if (!signatureHeader) return { ok: false, reason: 'header_manquant' };
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody || '').digest('hex');
  const provided = String(signatureHeader).replace(/^sha256=/, '').trim();
  try {
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(provided, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'longueur_invalide' };
    return { ok: crypto.timingSafeEqual(a, b) };
  } catch {
    return { ok: false, reason: 'signature_invalide' };
  }
}

async function findPayout(db, { payoutId, meta }) {
  if (payoutId) {
    const p = await withdrawalRepo.findPayoutByPayoutId(db, payoutId);
    if (p) return p;
  }
  const withdrawalId = pickString(meta.withdrawalId, meta.withdrawal_id);
  if (withdrawalId) {
    return withdrawalRepo.findPayoutByWithdrawalId(db, withdrawalId);
  }
  return null;
}

async function logEvent(db, { payoutId, status, payload }) {
  if (!payoutId) return { inserted: false, reason: 'pawapay_id_manquant' };
  const { data, error } = await db
    .from('pawapay_events')
    .insert({
      event_type: 'payout',
      pawapay_id: payoutId,
      status: status || null,
      payload: payload || {},
    })
    .select('id')
    .maybeSingle();
  if (error) {
    if (/unique|duplicate/i.test(error.message || '')) {
      return { inserted: false, duplicate: true };
    }
    throw error;
  }
  return { inserted: true, id: data?.id };
}

async function handle(db, payload, { rawBody, signature } = {}) {
  const sigCheck = verifySignature(rawBody || (typeof payload === 'string' ? payload : JSON.stringify(payload || {})), signature);
  if (!sigCheck.ok) {
    logWarn({ msg: 'pawapay_payout_signature_invalide', reason: sigCheck.reason });
    return { ok: false, code: 'SIGNATURE_INVALIDE' };
  }

  const status = pickString(payload.status, payload.transactionStatus, payload.State);
  const payoutId = extractPawapayId('payout', payload);
  const meta = extractMetadata(payload.metadata);

  logInfo({ msg: 'pawapay_payout_webhook', payoutId, status });

  try {
    const log = await logEvent(db, { payoutId, status, payload });
    if (log.duplicate) return { ok: true, dejaTraite: true };
  } catch (err) {
    logError({ msg: 'pawapay_payout_log_failed', error: err.message });
  }

  const payoutRow = await findPayout(db, { payoutId, meta });
  if (!payoutRow) return { ok: true, ignored: 'payout_introuvable' };

  const now = new Date().toISOString();

  if (isSuccessStatus(status)) {
    await withdrawalRepo.updatePayout(db, payoutRow.id, {
      statut: 'reussi',
      termine_at: now,
      response_payload: { ...(payoutRow.responsePayload || {}), webhook: payload },
    });
    return withdrawalService.completeWithdrawal(db, null, { payoutId });
  }

  if (isFailedStatus(status)) {
    await withdrawalRepo.updatePayout(db, payoutRow.id, {
      statut: 'echoue',
      termine_at: now,
      erreur: status,
      response_payload: { ...(payoutRow.responsePayload || {}), webhook: payload },
    });
    return withdrawalService.failWithdrawal(db, null, `PawaPay ${status}`);
  }

  if (isProcessingStatus(status)) {
    await withdrawalRepo.updatePayout(db, payoutRow.id, {
      statut: 'en_traitement',
      response_payload: { ...(payoutRow.responsePayload || {}), webhook: payload },
    });
    return { ok: true, payoutRow, processing: true };
  }

  return { ok: true, ignored: 'statut_ignore', status };
}

module.exports = { handle, verifySignature };
