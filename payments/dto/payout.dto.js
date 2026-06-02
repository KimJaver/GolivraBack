/**
 * DTOs — Payouts / Retraits
 */

const VALID_METHODES = new Set(['airtel_money', 'mtn_money', 'mobile_money_autre', 'virement_bancaire']);

/**
 * Normalise un payload de demande de retrait.
 * @param {object} body
 * @returns {{montantFcfa: number, methode: string, numeroCompte: string, nomBeneficiaire?: string, noteDemandeur?: string}}
 */
function normalizeWithdrawalRequest(body = {}) {
  const methode = String(body.methode || 'airtel_money').trim().toLowerCase();
  const safeMethode = VALID_METHODES.has(methode) ? methode : 'airtel_money';
  return {
    montantFcfa: Number(body.montant),
    methode: safeMethode,
    numeroCompte: String(body.numero_compte || body.numeroCompte || '').trim(),
    nomBeneficiaire: body.nom_beneficiaire || body.nomBeneficiaire || null,
    noteDemandeur: body.note_demandeur || body.note || null,
  };
}

function withdrawalResponse(w) {
  if (!w) return null;
  return {
    id: w.id,
    montant_fcfa: w.montantFcfa,
    devise: w.devise,
    methode: w.methode,
    numero_compte: w.numeroCompte,
    statut: w.statut,
    payout_id: w.payoutId,
    motif_rejet: w.motifRejet,
    cree_le: w.creeLe,
    traite_le: w.traiteAt,
    processed_le: w.processedAt,
  };
}

module.exports = { normalizeWithdrawalRequest, withdrawalResponse, VALID_METHODES };
