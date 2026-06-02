/**
 * Service — PawaPay API client
 * Client HTTP minimal pour les opérations deposit / payout / refund.
 *
 * Variables d'environnement :
 *   - PAWAPAY_BASE_URL      : ex. https://api.sandbox.pawapay.io  (défaut sandbox)
 *   - PAWAPAY_API_KEY       : clé Bearer à fournir
 *   - PAWAPAY_WEBHOOK_SECRET: secret HMAC pour vérifier les webhooks
 *
 * Mode "simulation" : si PAWAPAY_API_KEY n'est pas défini, les méthodes renvoient
 * un objet factice (succès) — utile en dev / démo avant l'obtention des credentials.
 */

const { info: logInfo, warn: logWarn, error: logError } = require('../../utils/logger');

const BASE_URL = (process.env.PAWAPAY_BASE_URL || 'https://api.sandbox.pawapay.io').replace(/\/+$/, '');
const API_KEY = String(process.env.PAWAPAY_API_KEY || '').trim();
const WEBHOOK_SECRET = String(process.env.PAWAPAY_WEBHOOK_SECRET || '').trim();

function isLive() {
  return Boolean(API_KEY);
}

function countryToCorrespondent(country, provider) {
  const c = String(country || 'CG').toUpperCase();
  const p = String(provider || '').toLowerCase();
  if (c === 'CG') {
    if (p.includes('mtn')) return 'MTN_MOMO_CG';
    if (p.includes('airtel')) return 'AIRTEL_CG';
  }
  return null;
}

function providerToType(methode) {
  if (methode === 'mtn_money') return 'MTN';
  if (methode === 'airtel_money') return 'AIRTEL';
  return 'MM';
}

async function httpJson(path, body, { method = 'POST' } = {}) {
  if (!isLive()) {
    return { ok: false, simulated: true, reason: 'PAWAPAY_API_KEY manquant', path, body };
  }
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  if (text) {
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
  }
  if (!res.ok) {
    logError({ msg: 'pawapay_http_error', url, status: res.status, body: json });
    const err = new Error(`PawaPay ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

/**
 * Initie un deposit (paiement client).
 * @see https://docs.pawapay.io/#operation/initiateDeposit
 */
async function initiateDeposit({ depositId, montantFcfa, currency = 'XAF', methode, numeroCompte, pays = 'CG', metadata = [] }) {
  const payload = {
    depositId,
    amount: String(Number(montantFcfa).toFixed(2)),
    currency: String(currency || 'XAF').toUpperCase(),
    correspondent: countryToCorrespondent(pays, methode),
    payer: {
      type: 'MSISDN',
      address: { value: normalizePhone(numeroCompte) },
    },
    customerMessage: 'GoLivra',
    clientReferenceId: depositId,
    metadata,
  };
  try {
    const json = await httpJson('/deposits', payload);
    return { ok: true, simulated: false, data: json };
  } catch (err) {
    if (!isLive()) return { ok: true, simulated: true, data: null };
    return { ok: false, simulated: false, error: err.message, body: err.body };
  }
}

/**
 * Initie un payout (retrait vers Mobile Money).
 * @see https://docs.pawapay.io/#operation/initiatePayout
 */
async function initiatePayout({ payoutId, montantFcfa, currency = 'XAF', methode, numeroCompte, pays = 'CG', nomBeneficiaire, metadata = [] }) {
  const payload = {
    payoutId,
    amount: String(Number(montantFcfa).toFixed(2)),
    currency: String(currency || 'XAF').toUpperCase(),
    correspondent: countryToCorrespondent(pays, methode),
    recipient: {
      type: 'MSISDN',
      address: { value: normalizePhone(numeroCompte) },
    },
    customerMessage: 'GoLivra retrait',
    clientReferenceId: payoutId,
    metadata,
    ...(nomBeneficiaire ? { recipientName: nomBeneficiaire } : {}),
  };
  try {
    const json = await httpJson('/payouts', payload);
    return { ok: true, simulated: false, data: json };
  } catch (err) {
    if (!isLive()) return { ok: true, simulated: true, data: null };
    return { ok: false, simulated: false, error: err.message, body: err.body };
  }
}

/**
 * Vérifie le statut d'un payout.
 */
async function getPayoutStatus(payoutId) {
  if (!isLive()) return { ok: true, simulated: true, data: { payoutId, status: 'COMPLETED' } };
  try {
    const json = await httpJson(`/payouts/${encodeURIComponent(payoutId)}`, null, { method: 'GET' });
    return { ok: true, simulated: false, data: json };
  } catch (err) {
    return { ok: false, simulated: false, error: err.message, body: err.body };
  }
}

function normalizePhone(num) {
  if (!num) return null;
  const s = String(num).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return s;
  if (s.startsWith('00')) return `+${s.slice(2)}`;
  if (s.length === 9) return `+242${s}`;
  if (s.length === 12 && s.startsWith('242')) return `+${s}`;
  return s;
}

function logConfig() {
  logInfo({
    msg: 'pawapay_config',
    live: isLive(),
    base_url: BASE_URL,
    webhook_secret_set: Boolean(WEBHOOK_SECRET),
  });
}

module.exports = {
  isLive,
  initiateDeposit,
  initiatePayout,
  getPayoutStatus,
  normalizePhone,
  countryToCorrespondent,
  providerToType,
  logConfig,
  WEBHOOK_SECRET,
  BASE_URL,
  API_KEY,
};
