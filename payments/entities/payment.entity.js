/**
 * Entity — Payment (paiement commande)
 */

function rowToPayment(row) {
  if (!row) return null;
  return {
    id: row.id,
    commandeId: row.commande_id,
    utilisateurId: row.utilisateur_id,
    montantFcfa: Number(row.montant ?? 0),
    methode: row.methode,
    statut: row.statut,
    referenceExterne: row.reference_externe || null,
    numeroTransaction: row.numero_transaction || null,
    pawapayDepositId: row.pawapay_deposit_id || null,
    pawapayPayoutId: row.pawapay_payout_id || null,
    escrowId: row.escrow_id || null,
    providerCountry: row.provider_country || null,
    providerCorrespondent: row.provider_correspondent || null,
    failureReason: row.failure_reason || null,
    refundedAt: row.refunded_at || null,
    payeAt: row.paye_at || null,
    metadata: row.metadata || null,
    creeLe: row.created_at,
    misAJourLe: row.updated_at,
  };
}

module.exports = { rowToPayment };
