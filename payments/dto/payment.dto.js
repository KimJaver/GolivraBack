/**
 * DTOs — Paiements (entrée / sortie HTTP)
 */

/**
 * Normalise un payload de demande de paiement client.
 * @param {object} body
 * @returns {{commandeId: string, methode: string, providerCountry?: string, providerCorrespondent?: string}}
 */
function normalizePaymentRequest(body = {}) {
  const methodeRaw = String(body.provider || body.methodePaiement || body.methode || '').trim().toLowerCase();
  const PROVIDERS = {
    airtel: 'airtel_money',
    airtel_money: 'airtel_money',
    mtn: 'mtn_money',
    mtn_money: 'mtn_money',
    portefeuille: 'portefeuille_golivra',
    portefeuille_golivra: 'portefeuille_golivra',
  };
  const methode = PROVIDERS[methodeRaw] || 'airtel_money';
  return {
    methode,
    providerCountry: body.providerCountry || body.pays || 'CG',
    providerCorrespondent: body.providerCorrespondent || body.correspondant || null,
    numeroCompte: body.numero_compte || body.numeroCompte || null,
  };
}

function paymentResponse(p) {
  if (!p) return null;
  return {
    id: p.id,
    statut: p.statut,
    methode: p.methode,
    montant_fcfa: p.montantFcfa,
    reference: p.referenceExterne || p.numeroTransaction || p.pawapayDepositId,
    pawapay_deposit_id: p.pawapayDepositId,
    paye_at: p.payeAt,
    cree_le: p.creeLe,
  };
}

module.exports = { normalizePaymentRequest, paymentResponse };
