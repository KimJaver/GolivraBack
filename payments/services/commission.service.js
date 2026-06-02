/**
 * Service — Commission Engine
 * Moteur de commission paramétrable. Toutes les commissions sont
 * calculées à partir de parametres_systeme + établissement + sous-commande.
 *
 * Règles :
 *  - Ventes (produits) : taux `default_sale_commission_percent` (override par
 *    restaurant/boutique via `commission_pct`).
 *  - Frais de livraison : taux `default_delivery_commission_percent` (override
 *    par entreprise logistique via `commission_pct`).
 *
 * Le résultat est une répartition immutable : marchand / logistique / plateforme.
 */

/**
 * @typedef {Object} CommissionInput
 * @property {number}  sousTotal         Sous-total produits (FCFA)
 * @property {number}  fraisLivraison    Frais de livraison (FCFA)
 * @property {object}  [etablissement]   row restaurant ou boutique
 * @property {object}  [entrepriseLogistique] row entreprise logistique
 * @property {object}  config            pricing config (de getPricingConfig)
 */

/**
 * @typedef {Object} CommissionBreakdown
 * @property {number} produitBrutFcfa
 * @property {number} commissionVenteFcfa
 * @property {number} produitNetFcfa              (à créditer au marchand)
 * @property {number} fraisLivraisonFcfa
 * @property {number} commissionLivraisonFcfa     (part GoLivra)
 * @property {number} fraisLivraisonNetFcfa       (à créditer livreur / logistique)
 * @property {number} commissionTotaleFcfa
 * @property {{ ventePct: number, livraisonPct: number }} taux
 * @property {{ produitNetPar: 'marchand', fraisNetPar: 'livreur_ou_logistique' }} repartition
 */

/**
 * @param {CommissionInput} input
 * @returns {CommissionBreakdown}
 */
function computeBreakdown(input) {
  const produitBrut = roundFcfa(input.sousTotal || 0);
  const frais = roundFcfa(input.fraisLivraison || 0);
  const config = input.config || {};

  // 1. Commission sur ventes — utilise le % de l'établissement si défini
  const ventePctFromEstablishment = readPct(input.etablissement?.commission_pct);
  const ventePct = inRange(ventePctFromEstablishment) ? ventePctFromEstablishment : Number(config.default_sale_commission_percent || 0);
  const commissionVente = produitBrut > 0 ? Math.round((produitBrut * ventePct) / 100) : 0;
  const produitNet = Math.max(0, produitBrut - commissionVente);

  // 2. Commission sur livraison — utilise le % de l'entreprise logistique si défini
  const livraisonPctFromCompany = readPct(input.entrepriseLogistique?.commission_pct);
  const livraisonPct = inRange(livraisonPctFromCompany)
    ? livraisonPctFromCompany
    : Number(config.default_delivery_commission_percent || 20);
  const commissionLivraison = frais > 0 ? Math.round((frais * livraisonPct) / 100) : 0;
  const fraisNet = Math.max(0, frais - commissionLivraison);

  return {
    produitBrutFcfa: produitBrut,
    commissionVenteFcfa: commissionVente,
    produitNetFcfa: produitNet,
    fraisLivraisonFcfa: frais,
    commissionLivraisonFcfa: commissionLivraison,
    fraisLivraisonNetFcfa: fraisNet,
    commissionTotaleFcfa: commissionVente + commissionLivraison,
    taux: { ventePct, livraisonPct },
    repartition: {
      produitNetPar: 'marchand',
      fraisNetPar: input.entrepriseLogistique ? 'entreprise_logistique' : 'livreur',
    },
  };
}

function readPct(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function inRange(pct) {
  return pct != null && pct >= 0 && pct <= 100;
}

function roundFcfa(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.round(v);
}

module.exports = { computeBreakdown, roundFcfa };
