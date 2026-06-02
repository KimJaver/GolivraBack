/**
 * Controller — Sandbox (admin uniquement)
 * Permet de définir le scénario PawaPay actif pour tester les flux
 * de paiement et de retrait sans téléphone réel.
 *
 * Routes :
 *   GET    /api/admin/sandbox/scenarios                    — liste tous les scénarios par opérateur
 *   GET    /api/admin/sandbox/scenarios/actifs             — liste tous les scénarios épinglés (debug)
 *   GET    /api/admin/sandbox/scenario?operateur=&user=&commande=
 *                                                          — récupère le scénario actif pour un triplet
 *   POST   /api/admin/sandbox/scenario                     — définit un scénario
 *   DELETE /api/admin/sandbox/scenario                     — supprime un scénario
 *
 * Exemple POST :
 *   { "scope": "user", "operateur": "AIRTEL_COG", "scenario": "SOLDE_INSUFFISANT",
 *     "utilisateurId": "uuid", "ttlMinutes": 30 }
 */

const sandboxService = require('../services/pawapay-sandbox.service');
const { createHttpError, requireFields } = require('../../utils/http');

const VALID_SCOPES = new Set(['user', 'commande', 'global']);

function normalizeOperator(input) {
  if (!input) return null;
  return sandboxService.operatorKey(input) || String(input).toUpperCase();
}

function getActive(req, res, next) {
  try {
    const utilisateurId = typeof req.query.utilisateurId === 'string' ? req.query.utilisateurId.trim() : null;
    const commandeId = typeof req.query.commandeId === 'string' ? req.query.commandeId.trim() : null;
    const operateur = normalizeOperator(req.query.operateur);
    if (!operateur) {
      throw createHttpError(400, `Paramètre operateur requis. Valeurs : ${sandboxService.OPERATOR_KEYS.join(', ')}`);
    }
    const active = sandboxService.getScenario({ utilisateurId, commandeId, operateur });
    if (!active) {
      return res.json({
        actif: false,
        operateur,
        scenario: null,
        defaut: sandboxService.DEFAULT_SCENARIO,
        message: `Aucun scénario épinglé pour ${operateur} — le backend applique le scénario par défaut (${sandboxService.DEFAULT_SCENARIO}).`,
      });
    }
    return res.json({ actif: true, ...active });
  } catch (err) {
    return next(err);
  }
}

function listAvailable(_req, res) {
  return res.json({
    defaut: sandboxService.DEFAULT_SCENARIO,
    operateurs: sandboxService.listScenarios(),
  });
}

function listAllActive(_req, res) {
  return res.json({ actifs: sandboxService.listActive() });
}

function setScenario(req, res, next) {
  try {
    requireFields(req.body, ['operateur', 'scenario']);
    const operateur = normalizeOperator(req.body.operateur);
    if (!operateur) {
      throw createHttpError(400, `operateur invalide. Valeurs : ${sandboxService.OPERATOR_KEYS.join(', ')}`);
    }
    const scope = req.body.scope || 'global';
    if (!VALID_SCOPES.has(scope)) {
      throw createHttpError(400, `scope invalide. Valeurs : ${[...VALID_SCOPES].join(', ')}`);
    }
    const { scenario } = req.body;
    const utilisateurId = req.body.utilisateurId || null;
    const commandeId = req.body.commandeId || null;
    if (scope === 'user' && !utilisateurId) throw createHttpError(400, 'utilisateurId requis pour scope=user');
    if (scope === 'commande' && !commandeId) throw createHttpError(400, 'commandeId requis pour scope=commande');
    const ttlMinutes = Number(req.body.ttlMinutes) > 0 ? Number(req.body.ttlMinutes) : 30;
    const result = sandboxService.setScenario({ scope, operateur, scenario, utilisateurId, commandeId, ttlMinutes });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

function clearScenario(req, res, next) {
  try {
    const operateur = normalizeOperator(req.query.operateur);
    if (!operateur) {
      throw createHttpError(400, `Query operateur requis. Valeurs : ${sandboxService.OPERATOR_KEYS.join(', ')}`);
    }
    const scope = req.query.scope || null;
    if (scope && !VALID_SCOPES.has(scope)) {
      throw createHttpError(400, `scope invalide. Valeurs : ${[...VALID_SCOPES].join(', ')}`);
    }
    const utilisateurId = req.query.utilisateurId || null;
    const commandeId = req.query.commandeId || null;
    const all = String(req.query.all || '').toLowerCase() === 'true';
    const result = sandboxService.clearScenario({ scope, operateur, utilisateurId, commandeId, all });
    return res.json({ ok: true, ...result });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getActive,
  listAvailable,
  listAllActive,
  setScenario,
  clearScenario,
};
