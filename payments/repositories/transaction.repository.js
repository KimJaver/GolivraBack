/**
 * Repository — Transactions portefeuille
 * Mouvements crédit / débit sur un portefeuille.
 */

const { rowToTransaction } = require('../entities/transaction.entity');

async function insert(db, tx) {
  const { data, error } = await db
    .from('transactions_portefeuille')
    .insert({
      portefeuille_id: tx.portefeuilleId,
      type: tx.type,
      montant: tx.montantFcfa,
      solde_avant: tx.soldeAvantFcfa,
      solde_apres: tx.soldeApresFcfa,
      reference_type: tx.referenceType || null,
      reference_id: tx.referenceId || null,
      description: tx.description || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToTransaction(data);
}

async function findById(db, transactionId) {
  const { data, error } = await db
    .from('transactions_portefeuille')
    .select('*')
    .eq('id', transactionId)
    .maybeSingle();
  if (error) throw error;
  return rowToTransaction(data);
}

async function existsFor(db, { portefeuilleId, type, referenceType, referenceId }) {
  if (!referenceType || !referenceId) return false;
  const { data } = await db
    .from('transactions_portefeuille')
    .select('id')
    .eq('portefeuille_id', portefeuilleId)
    .eq('type', type)
    .eq('reference_type', referenceType)
    .eq('reference_id', referenceId)
    .maybeSingle();
  return Boolean(data?.id);
}

async function listForPortefeuille(db, portefeuilleId, { limit = 50 } = {}) {
  const { data, error } = await db
    .from('transactions_portefeuille')
    .select('*')
    .eq('portefeuille_id', portefeuilleId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(rowToTransaction);
}

module.exports = { insert, findById, existsFor, listForPortefeuille };
