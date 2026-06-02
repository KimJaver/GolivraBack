/**
 * DTOs — Webhooks PawaPay
 * Normalisation des payloads entrants.
 */

function isSuccessStatus(status) {
  const s = String(status || '').toUpperCase();
  return s === 'COMPLETED' || s === 'SUCCESS' || s === 'SUCCESSFUL' || s === 'ACCEPTED' || s === 'PAID';
}

function isFailedStatus(status) {
  const s = String(status || '').toUpperCase();
  return s === 'FAILED' || s === 'REJECTED' || s === 'CANCELLED' || s === 'EXPIRED' || s === 'ERROR';
}

function isProcessingStatus(status) {
  const s = String(status || '').toUpperCase();
  return s === 'PENDING' || s === 'PROCESSING' || s === 'IN_PROGRESS' || s === 'ACCEPTED' || s === 'SUBMITTED';
}

function extractMetadata(metadata) {
  const out = {};
  if (Array.isArray(metadata)) {
    for (const m of metadata) {
      if (m && typeof m.fieldName === 'string') out[m.fieldName] = m.fieldValue;
    }
  } else if (metadata && typeof metadata === 'object') {
    Object.assign(out, metadata);
  }
  return out;
}

function pickString(...candidates) {
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const s = String(c).trim();
    if (s) return s;
  }
  return null;
}

/**
 * Extrait l'identifiant PawaPay du payload, quel que soit le type d'événement.
 * @param {'deposit'|'payout'|'refund'} eventType
 * @param {object} payload
 */
function extractPawapayId(eventType, payload = {}) {
  if (eventType === 'deposit') return pickString(payload.depositId, payload.id);
  if (eventType === 'payout')  return pickString(payload.payoutId, payload.id);
  if (eventType === 'refund')  return pickString(payload.refundId, payload.id);
  return null;
}

module.exports = {
  isSuccessStatus,
  isFailedStatus,
  isProcessingStatus,
  extractMetadata,
  pickString,
  extractPawapayId,
};
