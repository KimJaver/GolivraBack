/**
 * Controller — Payout / Withdrawal
 * Routes client : POST /api/payouts (demande), GET /api/payouts (historique)
 */

const { getDb } = require('../../config/db');
const { createHttpError, requireFields } = require('../../utils/http');
const withdrawalService = require('../services/withdrawal.service');
const withdrawalRepo = require('../repositories/withdrawal.repository');
const walletService = require('../services/wallet.service');
const { normalizeWithdrawalRequest, withdrawalResponse } = require('../dto/payout.dto');

/**
 * POST /api/payouts
 * Demande de retrait depuis le portefeuille.
 */
async function createWithdrawal(req, res, next) {
  try {
    requireFields(req.body, ['montant', 'numero_compte']);
    const db = getDb();
    const payload = normalizeWithdrawalRequest(req.body);
    const withdrawal = await withdrawalService.createRequest(
      db,
      req.auth.userId,
      payload,
      { role: req.auth.role },
    );
    return res.status(201).json(withdrawalResponse(withdrawal));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/payouts
 * Historique des retraits de l'utilisateur.
 */
async function listMyWithdrawals(req, res, next) {
  try {
    const db = getDb();
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const list = await withdrawalRepo.listForUser(db, req.auth.userId, { limit });
    return res.json(list.map(withdrawalResponse));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/payouts/:withdrawalId
 * Détail d'un retrait.
 */
async function getWithdrawal(req, res, next) {
  try {
    const { withdrawalId } = req.params;
    const db = getDb();
    const w = await withdrawalRepo.findById(db, withdrawalId);
    if (!w) throw createHttpError(404, 'Demande de retrait introuvable.');
    if (w.utilisateurId !== req.auth.userId && req.auth.role !== 'admin') {
      throw createHttpError(403, 'Accès non autorisé.');
    }
    return res.json(withdrawalResponse(w));
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/payouts/info
 * Configuration publique des retraits.
 */
function getWithdrawalInfo(_req, res) {
  return res.json({
    montant_minimum_fcfa: withdrawalService.MIN_WITHDRAW_FCFA,
    montant_maximum_fcfa: withdrawalService.MAX_WITHDRAW_FCFA,
    methodes_supportees: ['airtel_money', 'mtn_money'],
    delai_traitement: 'Automatique pour les commerces, livreurs et entreprises logistiques',
    validation_admin_requise: false,
    note: 'En mode test, les retraits sont validés automatiquement.',
  });
}

/**
 * GET /api/wallet/me
 * Solde + ledger du portefeuille courant.
 */
async function getMyWallet(req, res, next) {
  try {
    const db = getDb();
    const [solde, transactions, ledger] = await Promise.all([
      walletService.getSolde(db, req.auth.userId),
      walletService.listTransactions(db, req.auth.userId, { limit: 25 }),
      walletService.listLedger(db, req.auth.userId, { limit: 25 }),
    ]);
    return res.json({ ...solde, transactions, ledger });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createWithdrawal,
  listMyWithdrawals,
  getWithdrawal,
  getWithdrawalInfo,
  getMyWallet,
};
