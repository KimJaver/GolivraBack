/**
 * Entity — Escrow (paiement client temporairement bloqué)
 */

function rowToEscrow(row) {
  if (!row) return null;
  return {
    id: row.id,
    commandeId: row.commande_id,
    paiementId: row.paiement_id,
    restaurantId: row.restaurant_id || null,
    boutiqueId: row.boutique_id || null,
    montantFcfa: Number(row.montant ?? 0),
    commissionPct: Number(row.commission_pct ?? 0),
    commissionTtcFcfa: Number(row.commission_ttc ?? 0),
    montantEtablissementFcfa: Number(row.montant_etablissement ?? 0),
    fraisLivraisonFcfa: Number(row.frais_livraison ?? 0),
    devise: row.devise || 'XAF',
    statut: row.statut,
    bloqueAt: row.bloque_at || null,
    libereAt: row.libere_at || null,
    rembourseAt: row.rembourse_at || null,
    annuleAt: row.annule_at || null,
    referenceExterne: row.reference_externe || null,
    metadata: row.metadata || null,
    creeLe: row.created_at,
    misAJourLe: row.updated_at,
  };
}

module.exports = { rowToEscrow };
