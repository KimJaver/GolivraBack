/**
 * Entity — Withdrawal (demande de retrait + intégration PawaPay)
 */

function rowToWithdrawal(row) {
  if (!row) return null;
  return {
    id: row.id,
    portefeuilleId: row.portefeuille_id,
    utilisateurId: row.utilisateur_id,
    montantFcfa: Number(row.montant ?? 0),
    devise: row.devise || 'XAF',
    methode: row.methode,
    numeroCompte: row.numero_compte,
    nomBeneficiaire: row.nom_beneficiaire || null,
    statut: row.statut,
    motifRejet: row.motif_rejet || null,
    noteDemandeur: row.note_demandeur || null,
    noteAdmin: row.note_admin || null,
    payoutId: row.payout_id || null,
    payoutFailureReason: row.payout_failure_reason || null,
    tentatives: Number(row.tentatives ?? 0),
    traitePar: row.traite_par || null,
    traiteAt: row.traite_at || null,
    processedAt: row.processed_at || null,
    creeLe: row.created_at,
    misAJourLe: row.updated_at,
  };
}

function rowToPayout(row) {
  if (!row) return null;
  return {
    id: row.id,
    withdrawalId: row.withdrawal_id,
    payoutId: row.payout_id || null,
    statut: row.statut,
    montantFcfa: Number(row.montant ?? 0),
    devise: row.devise || 'XAF',
    methode: row.methode,
    numeroCompte: row.numero_compte,
    pays: row.pays || 'CG',
    correspondant: row.correspondant || null,
    requestPayload: row.request_payload || null,
    responsePayload: row.response_payload || null,
    erreur: row.erreur || null,
    soumisAt: row.soumis_at || null,
    termineAt: row.termine_at || null,
    creeLe: row.created_at,
    misAJourLe: row.updated_at,
  };
}

module.exports = { rowToWithdrawal, rowToPayout };
