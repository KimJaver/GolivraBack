/**
 * Service — Ledger
 * Écriture des mouvements comptables dans `ledger_entries`.
 * Garantit la traçabilité totale : un ledger entry = un mouvement.
 */

const ledgerRepo = require('../repositories/ledger.repository');
const { createHttpError } = require('../../utils/http');

/**
 * Écrit une ligne de ledger et (optionnellement) la transaction portefeuille liée.
 * @returns {Promise<{ ledger: object, transaction: object | null }>}
 */
async function record({
  db,
  portefeuilleId,
  sens,            // 'credit' | 'debit'
  montantFcfa,
  soldeAvantFcfa,
  soldeApresFcfa,
  type,            // 'deposit' | 'escrow_hold' | ...
  referenceType,
  referenceId,
  transactionPortefeuilleId = null,
  description = null,
  metadata = null,
  devise = 'XAF',
}) {
  if (!portefeuilleId) throw createHttpError(500, 'portefeuilleId requis pour ledger');
  if (!['credit', 'debit'].includes(sens)) {
    throw createHttpError(500, 'sens invalide (credit | debit)');
  }
  if (!Number.isFinite(Number(montantFcfa)) || Number(montantFcfa) <= 0) {
    throw createHttpError(500, 'montant ledger invalide');
  }
  const ledger = await ledgerRepo.insert(db, {
    portefeuilleId,
    sens,
    montantFcfa: Number(montantFcfa),
    soldeAvantFcfa: Number(soldeAvantFcfa ?? 0),
    soldeApresFcfa: Number(soldeApresFcfa ?? 0),
    devise,
    type,
    referenceType,
    referenceId,
    transactionPortefeuilleId,
    description,
    metadata,
  });
  return { ledger };
}

async function listForPortefeuille(db, portefeuilleId, { limit = 50 } = {}) {
  return ledgerRepo.listForPortefeuille(db, portefeuilleId, { limit });
}

async function listForReference(db, { referenceType, referenceId }) {
  return ledgerRepo.listForReference(db, { referenceType, referenceId });
}

async function sumCredits(db, { portefeuilleId, type, referenceType, referenceId }) {
  return ledgerRepo.sumCreditsFor(db, { portefeuilleId, type, referenceType, referenceId });
}

module.exports = { record, listForPortefeuille, listForReference, sumCredits };
