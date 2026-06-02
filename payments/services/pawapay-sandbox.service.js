/**
 * Service — PawaPay Sandbox Scenarios
 * ───────────────────────────────────────────────────────────────────────────
 * Mapping centralisé des numéros de test PawaPay Sandbox (Congo Brazzaville).
 * STRICTEMENT séparé par opérateur — pas de mélange MTN / Airtel.
 *
 * Règles d'or :
 *   1. L'app mobile envoie TOUJOURS le vrai numéro de l'utilisateur.
 *   2. Le backend swap vers le numéro sandbox UNIQUEMENT en mode test
 *      (pawapay.service.isLive() === false).
 *   3. L'app ne connaît jamais ces numéros.
 *   4. L'admin GoLivra peut « épingler » un scénario par opérateur pour
 *      un user, une commande, ou en global (cf. /api/admin/sandbox/scenario).
 *   5. Sans scénario actif, on applique le scénario par défaut (SUCCESS).
 *
 * Sources : documentation PawaPay Sandbox CG (Airtel / MTN MoMo).
 *
 *   MTN  Congo : préfixe 24206...
 *   Airtel Congo : préfixe 24205...
 */

// ── Mapping interne GoLivra → clé sandbox ────────────────────────────────────
const METHODE_TO_OPERATOR_KEY = {
  mtn_money: 'MTN_COG',
  MTN_MOMO_CG: 'MTN_COG',
  mtn_momo_cg: 'MTN_COG',
  airtel_money: 'AIRTEL_COG',
  AIRTEL_CG: 'AIRTEL_COG',
  airtel_cg: 'AIRTEL_COG',
};

const OPERATOR_KEY_TO_METHODE = {
  MTN_COG: 'mtn_money',
  AIRTEL_COG: 'airtel_money',
};

// ── Tables de scénarios par opérateur ──────────────────────────────────────
const SANDBOX = {
  MTN_COG: {
    pays: 'CG',
    methode: 'mtn_money',
    success:         { msisdn: '+242063456789', statutAttendu: 'COMPLETED', delaiMs: 5_000,  libelle: 'Paiement réussi',                                messageAdmin: 'Flux nominal : dépôt accepté, webhook COMPLETED.' },
    payeur_introuvable: { msisdn: '+242063456029', statutAttendu: 'FAILED',    delaiMs: 3_000,  libelle: 'Payeur introuvable',                                messageAdmin: 'Le numéro client n\'existe pas chez l\'opérateur.' },
    paiement_non_approuve: { msisdn: '+242063456039', statutAttendu: 'FAILED',    delaiMs: 3_000,  libelle: 'Paiement non approuvé',                            messageAdmin: 'L\'utilisateur a rejeté la demande sur son téléphone.' },
    solde_insuffisant: { msisdn: '+242063456049', statutAttendu: 'FAILED',    delaiMs: 3_000,  libelle: 'Solde insuffisant',                                 messageAdmin: 'Compte Mobile Money du client insuffisamment provisionné.' },
    autre_erreur:    { msisdn: '+242063456069', statutAttendu: 'FAILED',    delaiMs: 3_000,  libelle: 'Autre erreur opérateur',                            messageAdmin: 'Erreur générique côté opérateur Mobile Money.' },
    bloque_soumis:   { msisdn: '+242063456129', statutAttendu: 'PENDING',   delaiMs: 0,      libelle: 'Transaction bloquée / soumise',                    messageAdmin: 'La transaction reste en PENDING — utile pour tester l\'état intermédiaire.' },
    destinataire_introuvable: { msisdn: '+242063456089', statutAttendu: 'FAILED',    delaiMs: 3_000,  libelle: 'Destinataire introuvable (payout)',                 messageAdmin: 'Le numéro destinataire du retrait n\'existe pas.' },
  },
  AIRTEL_COG: {
    pays: 'CG',
    methode: 'airtel_money',
    success:         { msisdn: '+242053456789', statutAttendu: 'COMPLETED', delaiMs: 5_000,  libelle: 'Paiement réussi',                                messageAdmin: 'Flux nominal : dépôt accepté, webhook COMPLETED.' },
    paiement_non_approuve: { msisdn: '+242053456039', statutAttendu: 'FAILED',    delaiMs: 3_000,  libelle: 'Paiement non approuvé',                            messageAdmin: 'L\'utilisateur a rejeté la demande sur son téléphone.' },
    solde_insuffisant: { msisdn: '+242053456049', statutAttendu: 'FAILED',    delaiMs: 3_000,  libelle: 'Solde insuffisant',                                 messageAdmin: 'Compte Airtel Money du client insuffisamment provisionné.' },
    autre_erreur:    { msisdn: '+242053456069', statutAttendu: 'FAILED',    delaiMs: 3_000,  libelle: 'Autre erreur opérateur',                            messageAdmin: 'Erreur générique côté Airtel Money.' },
    bloque_soumis:   { msisdn: '+242053456129', statutAttendu: 'PENDING',   delaiMs: 0,      libelle: 'Transaction bloquée / soumise',                    messageAdmin: 'La transaction reste en PENDING — utile pour tester l\'état intermédiaire.' },
    destinataire_introuvable: { msisdn: '+242053456089', statutAttendu: 'FAILED',    delaiMs: 3_000,  libelle: 'Destinataire introuvable (payout)',                 messageAdmin: 'Le numéro destinataire du retrait n\'existe pas.' },
  },
};

const SCENARIO_KEYS_BY_OPERATOR = Object.fromEntries(
  Object.entries(SANDBOX).map(([opKey, scenarios]) => [opKey, Object.keys(scenarios)]),
);

const DEFAULT_SCENARIO = 'success';

const { info: logInfo, warn: logWarn } = require('../../utils/logger');

// ── Store en mémoire (TTL) ──────────────────────────────────────────────────
//   clé = "user:<id>:<opKey>" | "commande:<id>:<opKey>" | "global:<opKey>"
//   valeur = { scenario, expireAt, setAt }
const store = new Map();

function operatorKey(methodeOuKey) {
  if (!methodeOuKey) return null;
  if (SANDBOX[methodeOuKey]) return methodeOuKey; // déjà une clé ('MTN_COG')
  return METHODE_TO_OPERATOR_KEY[methodeOuKey] || null;
}

function scopeKey(scope, ids, opKey) {
  if (scope === 'user') return `user:${ids.utilisateurId}:${opKey}`;
  if (scope === 'commande') return `commande:${ids.commandeId}:${opKey}`;
  return `global:${opKey}`;
}

function isValidScenario(opKey, scenario) {
  return Boolean(SANDBOX[opKey] && SANDBOX[opKey][scenario]);
}

function setScenario({ scope = 'global', operateur, scenario, utilisateurId = null, commandeId = null, ttlMinutes = 30 }) {
  const opKey = operatorKey(operateur);
  if (!opKey) throw new Error(`Opérateur inconnu : ${operateur}. Attendus : ${Object.keys(SANDBOX).join(', ')}`);
  if (!isValidScenario(opKey, scenario)) {
    throw new Error(`Scénario inconnu pour ${opKey} : ${scenario}. Valeurs acceptées : ${SCENARIO_KEYS_BY_OPERATOR[opKey].join(', ')}`);
  }
  const key = scopeKey(scope, { utilisateurId, commandeId }, opKey);
  const expireAt = Date.now() + ttlMinutes * 60_000;
  store.set(key, { scenario, expireAt, setAt: Date.now(), scope, opKey });
  logInfo({ msg: 'sandbox_scenario_set', key, scope, operateur: opKey, scenario, ttl_minutes: ttlMinutes });
  return { key, scope, operateur: opKey, scenario, expireAt: new Date(expireAt).toISOString() };
}

function getScenario({ utilisateurId = null, commandeId = null, operateur = null } = {}) {
  const opKey = operatorKey(operateur);
  if (!opKey) return null;

  // Ordre de priorité : commande > user > global (tous scopés par opérateur)
  const orderedKeys = [
    commandeId ? `commande:${commandeId}:${opKey}` : null,
    utilisateurId ? `user:${utilisateurId}:${opKey}` : null,
    `global:${opKey}`,
  ].filter(Boolean);

  for (const k of orderedKeys) {
    const entry = store.get(k);
    if (!entry) continue;
    if (Date.now() > entry.expireAt) {
      store.delete(k);
      continue;
    }
    return { key: k, scenario: entry.scenario, operateur: opKey, expireAt: new Date(entry.expireAt).toISOString() };
  }
  return null;
}

function clearScenario({ scope = null, operateur = null, utilisateurId = null, commandeId = null, all = false } = {}) {
  if (all) {
    const size = store.size;
    store.clear();
    return { cleared: true, scope: 'all', count: size };
  }
  const opKey = operatorKey(operateur);
  if (!opKey) throw new Error(`Opérateur inconnu : ${operateur}`);
  const key = scopeKey(scope, { utilisateurId, commandeId }, opKey);
  const existed = store.delete(key);
  return { cleared: existed, key };
}

function listScenarios() {
  const out = {};
  for (const [opKey, scenarios] of Object.entries(SANDBOX)) {
    out[opKey] = {
      pays: scenarios.pays,
      methode: scenarios.methode,
      scenarios: Object.entries(scenarios).filter(([k]) => k !== 'pays' && k !== 'methode').map(([cle, def]) => ({
        cle,
        libelle: def.libelle,
        statut_attendu: def.statutAttendu,
        delai_ms: def.delaiMs,
        msisdn: def.msisdn,
        message_admin: def.messageAdmin,
      })),
    };
  }
  return out;
}

function listActive() {
  const out = [];
  for (const [key, entry] of store.entries()) {
    if (Date.now() > entry.expireAt) {
      store.delete(key);
      continue;
    }
    out.push({
      key,
      scope: entry.scope,
      operateur: entry.opKey,
      scenario: entry.scenario,
      expire_at: new Date(entry.expireAt).toISOString(),
      set_at: new Date(entry.setAt).toISOString(),
    });
  }
  return out;
}

/**
 * Résout le scénario actif pour un user/commande/opérateur, et renvoie
 * le MSISDN + opérateur + statut attendu à utiliser.
 *
 * En mode live → renvoie le vrai numéro, jamais de swap.
 * En mode sandbox → applique le scénario épinglé (ou SUCCESS par défaut).
 *
 * @param {object} args
 * @param {string} [args.utilisateurId]
 * @param {string} [args.commandeId]
 * @param {string} [args.numeroCompte]    Numéro « réel » envoyé par l'app mobile
 * @param {string} [args.operateur]       'mtn_money' | 'airtel_money' (ou 'MTN_COG' / 'AIRTEL_COG')
 * @returns {{
 *   mode: 'sandbox' | 'live',
 *   numeroCompte: string,
 *   numeroReel: string | null,
 *   operateur: string,         // clé sandbox ('MTN_COG' / 'AIRTEL_COG')
 *   methode: string,           // 'mtn_money' | 'airtel_money'
 *   pays: string,
 *   scenario: string | null,
 *   statutAttendu: string | null,
 *   delaiMs: number
 * }}
 */
function resolvePhoneForRequest({ utilisateurId = null, commandeId = null, numeroCompte = null, operateur = 'mtn_money' } = {}) {
  // Mode live → on utilise le vrai numéro, jamais de swap
  if (pawapayLive()) {
    return {
      mode: 'live',
      numeroCompte: numeroCompte || null,
      numeroReel: numeroCompte || null,
      operateur: operatorKey(operateur) || operateur,
      methode: operateur,
      pays: 'CG',
      scenario: null,
      statutAttendu: null,
      delaiMs: 0,
    };
  }

  // Mode sandbox
  const opKey = operatorKey(operateur);
  if (!opKey) {
    logWarn({ msg: 'sandbox_unknown_operator', operateur });
    return {
      mode: 'sandbox',
      numeroCompte: numeroCompte || null,
      numeroReel: numeroCompte || null,
      operateur: operateur || 'INCONNU',
      methode: operateur,
      pays: 'CG',
      scenario: null,
      statutAttendu: null,
      delaiMs: 0,
    };
  }

  const active = getScenario({ utilisateurId, commandeId, operateur });
  const scenarioKey = active?.scenario || DEFAULT_SCENARIO;
  const def = SANDBOX[opKey][scenarioKey] || SANDBOX[opKey][DEFAULT_SCENARIO];

  return {
    mode: 'sandbox',
    numeroCompte: def.msisdn,
    numeroReel: numeroCompte || null,
    operateur: opKey,
    methode: SANDBOX[opKey].methode,
    pays: SANDBOX[opKey].pays,
    scenario: scenarioKey,
    statutAttendu: def.statutAttendu,
    delaiMs: def.delaiMs,
  };
}

// Import paresseux pour éviter une dépendance circulaire
let _pawapayLive = null;
function pawapayLive() {
  if (_pawapayLive === null) {
    try {
      // eslint-disable-next-line global-require
      const pawapay = require('./pawapay.service');
      _pawapayLive = () => pawapay.isLive();
    } catch {
      _pawapayLive = () => false;
    }
  }
  return _pawapayLive();
}

module.exports = {
  SANDBOX,
  SCENARIO_KEYS_BY_OPERATOR,
  DEFAULT_SCENARIO,
  OPERATOR_KEYS: Object.keys(SANDBOX),
  operatorKey,
  setScenario,
  getScenario,
  clearScenario,
  listScenarios,
  listActive,
  resolvePhoneForRequest,
};
