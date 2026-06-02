/**
 * Entity — Transaction portefeuille (mouvement interne crédit / débit)
 */

function rowToTransaction(row) {
  if (!row) return null;
  return {
    id: row.id,
    portefeuilleId: row.portefeuille_id,
    type: row.type,
    montantFcfa: Number(row.montant ?? 0),
    soldeAvantFcfa: Number(row.solde_avant ?? 0),
    soldeApresFcfa: Number(row.solde_apres ?? 0),
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    description: row.description || null,
    creeLe: row.created_at,
  };
}

function rowToLedgerEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    portefeuilleId: row.portefeuille_id,
    sens: row.sens,
    montantFcfa: Number(row.montant ?? 0),
    soldeAvantFcfa: Number(row.solde_avant ?? 0),
    soldeApresFcfa: Number(row.solde_apres ?? 0),
    devise: row.devise || 'XAF',
    type: row.type,
    referenceType: row.reference_type || null,
    referenceId: row.reference_id || null,
    transactionPortefeuilleId: row.transaction_portefeuille_id || null,
    description: row.description || null,
    metadata: row.metadata || null,
    creeLe: row.created_at,
  };
}

module.exports = { rowToTransaction, rowToLedgerEntry };
