/**
 * Webhook PawaPay — refund (remboursement)
 *
 * Événement : COMPLETED → marque le paiement "rembourse" et débloque l'escrow.
 */

const crypto = require('crypto');
const paymentRepo = require('../repositories/payment.repository');
const escrowService = require('../services/escrow.service');
const { pickString, isSuccessStatus, isFailedStatus, extractPawapayId, extractMetadata } = require('../dto/webhook.dto');
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

async function findPaiement(db, { refundId, meta }) {
  const paiementId = pickString(meta.paiementId, meta.paiement_id);
  if (paiementId) return paymentRepo.findById(db, paiementId);
  const commandeId = pickString(meta.commandeId, meta.commande_id);
  if (commandeId) return paymentRepo.findLatestForCommande(db, commandeId);
  return null;
}

async function logEvent(db, { refundId, status, paiementId, payload }) {
  if (!refundId) return { inserted: false, reason: 'pawapay_id_manquant' };
  const { data, error } = await db
    .from('pawapay_events')
    .insert({
      event_type: 'refund',
      pawapay_id: refundId,
      status: status || null,
      paiement_id: paiementId || null,
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
    logWarn({ msg: 'pawapay_refund_signature_invalide', reason: sigCheck.reason });
    return { ok: false, code: 'SIGNATURE_INVALIDE' };
  }

  const status = pickString(payload.status, payload.transactionStatus, payload.State);
  const refundId = extractPawapayId('refund', payload);
  const meta = extractMetadata(payload.metadata);

  logInfo({ msg: 'pawapay_refund_webhook', refundId, status });

  try {
    const log = await logEvent(db, { refundId, status, paiementId: null, payload });
    if (log.duplicate) return { ok: true, dejaTraite: true };
  } catch (err) {
    logError({ msg: 'pawapay_refund_log_failed', error: err.message });
  }

  const paiement = await findPaiement(db, { refundId, meta });
  if (!paiement) return { ok: true, ignored: 'paiement_introuvable' };

  if (isSuccessStatus(status)) {
    const now = new Date().toISOString();
    const updated = await paymentRepo.update(db, paiement.id, {
      statut: 'rembourse',
      pawapay_payout_id: refundId,
      reference_externe: refundId,
      numero_transaction: refundId,
      refunded_at: now,
      metadata: { ...(paiement.metadata || {}), pawapay_refund: { payload, received_at: now } },
    });

    // Rembourse tous les escrows actifs de la commande
    let refunds = [];
    try {
      refunds = await escrowService.refundAllForCommande(db, paiement.commandeId, {
        motif: 'Remboursement PawaPay',
        payoutClient: true,
      });
    } catch (err) {
      logError({ msg: 'escrow_refund_after_webhook', error: err.message });
    }

    return { ok: true, paiement: updated, refunds };
  }

  if (isFailedStatus(status)) {
    logWarn({ msg: 'pawapay_refund_failed', refundId, status });
    return { ok: true, refundEchoue: true };
  }

  return { ok: true, ignored: 'statut_ignore', status };
}

module.exports = { handle, verifySignature };
