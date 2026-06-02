/**
 * Repository — Ledger (registre comptable par portefeuille)
 */

const { rowToLedgerEntry } = require('../entities/transaction.entity');

async function insert(db, entry) {
  const { data, error } = await db
    .from('ledger_entries')
    .insert({
      portefeuille_id: entry.portefeuilleId,
      sens: entry.sens,
      montant: entry.montantFcfa,
      solde_avant: entry.soldeAvantFcfa,
      solde_apres: entry.soldeApresFcfa,
      devise: entry.devise || 'XAF',
      type: entry.type,
      reference_type: entry.referenceType || null,
      reference_id: entry.referenceId || null,
      transaction_portefeuille_id: entry.transactionPortefeuilleId || null,
      description: entry.description || null,
      metadata: entry.metadata || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToLedgerEntry(data);
}

async function listForPortefeuille(db, portefeuilleId, { limit = 100 } = {}) {
  const { data, error } = await db
    .from('ledger_entries')
    .select('*')
    .eq('portefeuille_id', portefeuilleId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(rowToLedgerEntry);
}

async function listForReference(db, { referenceType, referenceId }) {
  if (!referenceType || !referenceId) return [];
  const { data, error } = await db
    .from('ledger_entries')
    .select('*')
    .eq('reference_type', referenceType)
    .eq('reference_id', referenceId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToLedgerEntry);
}

async function sumCreditsFor(db, { portefeuilleId, type, referenceType, referenceId }) {
  let q = db.from('ledger_entries').select('montant').eq('portefeuille_id', portefeuilleId).eq('sens', 'credit');
  if (type) q = q.eq('type', type);
  if (referenceType) q = q.eq('reference_type', referenceType);
  if (referenceId) q = q.eq('reference_id', referenceId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).reduce((acc, r) => acc + Number(r.montant), 0);
}

module.exports = { insert, listForPortefeuille, listForReference, sumCreditsFor };
