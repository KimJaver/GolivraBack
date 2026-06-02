/**
 * Service — Wallet
 * Opérations sur le portefeuille (crédit, débit, consultation).
 * Garantit l'idempotence via `transactions_portefeuille.reference_*` et
 * écrit systématiquement une ligne dans `ledger_entries`.
 */

const walletRepo = require('../repositories/wallet.repository');
const txRepo = require('../repositories/transaction.repository');
const ledger = require('./ledger.service');
const { createHttpError } = require('../../utils/http');
const { info: logInfo } = require('../../utils/logger');

const VALID_TYPES_CREDIT = new Set([
  'credit',
  'gain_livraison',
  'commission_logistique',
  'bonus',
  'remboursement',
]);
const VALID_TYPES_DEBIT = new Set([
  'debit',
  'commission_golivra',
]);

/**
 * Crée un portefeuille pour un utilisateur (idempotent).
 */
async function getOrCreate(db, utilisateurId) {
  return walletRepo.getOrCreate(db, utilisateurId);
}

/**
 * Crédite un portefeuille — écrit dans transactions_portefeuille + ledger.
 * Garantit l'idempotence via (portefeuille, type, referenceType, referenceId).
 */
async function credit(db, utilisateurId, montantFcfa, opts = {}) {
  const amount = Number(montantFcfa);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const type = opts.type || 'credit';
  if (!VALID_TYPES_CREDIT.has(type) && !type.startsWith('custom_')) {
    logInfo({ msg: 'wallet_credit_type_inconnu', type });
  }
  const wallet = await getOrCreate(db, utilisateurId);

  if (opts.referenceType && opts.referenceId) {
    const exists = await txRepo.existsFor(db, {
      portefeuilleId: wallet.id,
      type,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
    });
    if (exists) {
      return { wallet, transaction: null, ledger: null, idempotent: true };
    }
  }

  const soldeAvant = Number(wallet.soldeFcfa ?? 0);
  const soldeApres = roundFcfa(soldeAvant + amount);

  const transaction = await txRepo.insert(db, {
    portefeuilleId: wallet.id,
    type,
    montantFcfa: amount,
    soldeAvantFcfa: soldeAvant,
    soldeApresFcfa: soldeApres,
    referenceType: opts.referenceType || null,
    referenceId: opts.referenceId || null,
    description: opts.description || null,
  });

  const updated = await walletRepo.updateSolde(db, wallet.id, { solde: soldeApres });

  const ledgerEntry = await ledger.record({
    db,
    portefeuilleId: wallet.id,
    sens: 'credit',
    montantFcfa: amount,
    soldeAvantFcfa: soldeAvant,
    soldeApresFcfa: soldeApres,
    type: opts.ledgerType || mapCreditTypeToLedger(type),
    referenceType: opts.referenceType || null,
    referenceId: opts.referenceId || null,
    transactionPortefeuilleId: transaction.id,
    description: opts.description || null,
    metadata: opts.metadata || null,
  });

  return { wallet: updated, transaction, ledger: ledgerEntry.ledger };
}

/**
 * Débite un portefeuille (vérifie le solde disponible).
 */
async function debit(db, utilisateurId, montantFcfa, opts = {}) {
  const amount = Number(montantFcfa);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError(400, 'Montant de débit invalide.');
  }
  const type = opts.type || 'debit';
  const wallet = await getOrCreate(db, utilisateurId);

  if (opts.referenceType && opts.referenceId) {
    const exists = await txRepo.existsFor(db, {
      portefeuilleId: wallet.id,
      type,
      referenceType: opts.referenceType,
      referenceId: opts.referenceId,
    });
    if (exists) {
      return { wallet, transaction: null, ledger: null, idempotent: true };
    }
  }

  const soldeAvant = Number(wallet.soldeFcfa ?? 0);
  if (soldeAvant < amount) {
    throw createHttpError(400, 'Solde insuffisant.');
  }
  const soldeApres = roundFcfa(soldeAvant - amount);

  const transaction = await txRepo.insert(db, {
    portefeuilleId: wallet.id,
    type,
    montantFcfa: amount,
    soldeAvantFcfa: soldeAvant,
    soldeApresFcfa: soldeApres,
    referenceType: opts.referenceType || null,
    referenceId: opts.referenceId || null,
    description: opts.description || null,
  });

  const updated = await walletRepo.updateSolde(db, wallet.id, { solde: soldeApres });

  const ledgerEntry = await ledger.record({
    db,
    portefeuilleId: wallet.id,
    sens: 'debit',
    montantFcfa: amount,
    soldeAvantFcfa: soldeAvant,
    soldeApresFcfa: soldeApres,
    type: opts.ledgerType || mapDebitTypeToLedger(type),
    referenceType: opts.referenceType || null,
    referenceId: opts.referenceId || null,
    transactionPortefeuilleId: transaction.id,
    description: opts.description || null,
    metadata: opts.metadata || null,
  });

  return { wallet: updated, transaction, ledger: ledgerEntry.ledger };
}

async function getSolde(db, utilisateurId) {
  const w = await getOrCreate(db, utilisateurId);
  return {
    portefeuilleId: w.id,
    soldeFcfa: Number(w.soldeFcfa ?? 0),
    soldeEnAttenteFcfa: Number(w.soldeEnAttenteFcfa ?? 0),
    devise: w.devise,
  };
}

async function listTransactions(db, utilisateurId, { limit = 40 } = {}) {
  const w = await getOrCreate(db, utilisateurId);
  return txRepo.listForPortefeuille(db, w.id, { limit });
}

async function listLedger(db, utilisateurId, { limit = 40 } = {}) {
  const w = await getOrCreate(db, utilisateurId);
  return ledger.listForPortefeuille(db, w.id, { limit });
}

function roundFcfa(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function mapCreditTypeToLedger(type) {
  if (type === 'gain_livraison') return 'delivery_credit';
  if (type === 'remboursement') return 'escrow_refund';
  if (type === 'commission_logistique') return 'delivery_credit';
  return 'sale_credit';
}

function mapDebitTypeToLedger(type) {
  if (type === 'commission_golivra') return 'commission';
  return 'payout';
}

module.exports = {
  getOrCreate,
  credit,
  debit,
  getSolde,
  listTransactions,
  listLedger,
};
