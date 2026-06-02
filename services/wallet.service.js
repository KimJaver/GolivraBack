/**
 * Service legacy — Portefeuille (wallet)
 * ───────────────────────────────────────────────────────────────────────────
 * Ce module conserve les noms de fonctions utilisés historiquement par
 * l'écosystème GoLivra (wallet.controller, order.controller, dispatch.service…)
 * mais délègue toute la logique au nouveau module `payments/`.
 *
 * Toute nouvelle fonctionnalité doit être codée dans `payments/`. Ce wrapper
 * reste pour rétro-compatibilité.
 */

const { createHttpError } = require('../utils/http');
const { info: logInfo } = require('../utils/logger');
const walletService = require('../payments/services/wallet.service');
const escrowService = require('../payments/services/escrow.service');
const ledgerService = require('../payments/services/ledger.service');
const paymentRepo = require('../payments/repositories/payment.repository');
const withdrawalService = require('../payments/services/withdrawal.service');
const withdrawalRepo = require('../payments/repositories/withdrawal.repository');

async function getOrCreatePortefeuille(db, utilisateurId) {
  const w = await walletService.getOrCreate(db, utilisateurId);
  return {
    id: w.id,
    utilisateur_id: w.utilisateurId,
    solde: w.soldeFcfa,
    solde_en_attente: w.soldeEnAttenteFcfa,
    devise: w.devise,
    est_actif: w.estActif,
    created_at: w.creeLe,
    updated_at: w.misAJourLe,
  };
}

async function resolveGolivraPlatformUserId(db) {
  return escrowService.resolveGolivraPlatformUserId(db);
}

async function hasWalletTransaction(db, { portefeuilleId, type, referenceType, referenceId }) {
  const txRepo = require('../payments/repositories/transaction.repository');
  return txRepo.existsFor(db, { portefeuilleId, type, referenceType, referenceId });
}

async function creditWallet(db, utilisateurId, montant, opts = {}) {
  const r = await walletService.credit(db, utilisateurId, montant, opts);
  if (!r) return null;
  if (r.idempotent) {
    return getOrCreatePortefeuille(db, utilisateurId);
  }
  return {
    id: r.wallet.id,
    utilisateur_id: r.wallet.utilisateurId,
    solde: r.wallet.soldeFcfa,
    solde_en_attente: r.wallet.soldeEnAttenteFcfa,
    devise: r.wallet.devise,
    est_actif: r.wallet.estActif,
    created_at: r.wallet.creeLe,
    updated_at: r.wallet.misAJourLe,
  };
}

async function debitWallet(db, utilisateurId, montant, opts = {}) {
  const r = await walletService.debit(db, utilisateurId, montant, opts);
  return {
    id: r.wallet.id,
    utilisateur_id: r.wallet.utilisateurId,
    solde: r.wallet.soldeFcfa,
    solde_en_attente: r.wallet.soldeEnAttenteFcfa,
    devise: r.wallet.devise,
    est_actif: r.wallet.estActif,
    created_at: r.wallet.creeLe,
    updated_at: r.wallet.misAJourLe,
  };
}

/**
 * Wrapper legacy : holdOrderPaymentInEscrow(commandeId, paiementId)
 * Délègue au nouveau escrow.service.hold() qui crée une vraie ligne `escrows`.
 */
async function holdOrderPaymentInEscrow(db, commandeId, paiementId) {
  const r = await escrowService.hold(db, commandeId, paiementId);
  return {
    commande_id: commandeId,
    paiement_id: paiementId,
    deja_credite: Boolean(r.dejaBloque),
    montant_fcfa: r.totalBloqueFcfa || 0,
    escrow: !r.dejaBloque,
    escrows: r.escrows || [],
  };
}

async function creditVendorsOnOrderPaid(db, commandeId, paiementId) {
  return holdOrderPaymentInEscrow(db, commandeId, paiementId);
}

/**
 * Wrapper legacy : settleSousCommandePayout → libère l'escrow de la sous-commande.
 */
async function settleSousCommandePayout(db, sousCommandeId, livraison = null) {
  // Trouve l'escrow correspondant
  const escrowRepo = require('../payments/repositories/escrow.repository');
  const escrows = await escrowRepo.findByCommande(db, (await getCommandeIdFromSc(db, sousCommandeId)));
  let escrow = escrows.find((e) => e.metadata?.sousCommandeId === sousCommandeId);
  if (!escrow) {
    return { skipped: true, reason: 'escrow_introuvable', sous_commande_id: sousCommandeId };
  }
  if (escrow.statut === 'libere') {
    return { skipped: true, reason: 'deja_reglee', sous_commande_id: sousCommandeId };
  }
  const r = await escrowService.release(db, escrow.id, { livraison });
  return {
    sous_commande_id: sousCommandeId,
    produit_fcfa: r.produitNet,
    livreur_fcfa: r.fraisNet,
    golivra_fcfa: r.commissionLivraison,
    escrow: true,
  };
}

async function getCommandeIdFromSc(db, sousCommandeId) {
  const { data } = await db
    .from('sous_commandes')
    .select('commande_id')
    .eq('id', sousCommandeId)
    .maybeSingle();
  return data?.commande_id;
}

async function settleDeliveryFeesOnComplete(db, livraison) {
  if (!livraison?.sous_commande_id) {
    return { skipped: true, reason: 'sans_sous_commande' };
  }
  return settleSousCommandePayout(db, livraison.sous_commande_id, livraison);
}

async function resolveDeliveryCommissionPercent(db, entrepriseLogistiqueId) {
  if (entrepriseLogistiqueId) {
    const { data } = await db
      .from('entreprises_logistiques')
      .select('commission_pct')
      .eq('id', entrepriseLogistiqueId)
      .maybeSingle();
    const pct = Number(data?.commission_pct);
    if (Number.isFinite(pct) && pct >= 0 && pct <= 100) return pct;
  }
  const { getPricingConfig } = require('./pricing.service');
  const config = await getPricingConfig(db);
  return Number(config.delivery_platform_percent);
}

async function resolveLogisticsGestionnaireId(db, entrepriseLogistiqueId) {
  if (!entrepriseLogistiqueId) return null;
  const { data } = await db
    .from('entreprises_logistiques')
    .select('gestionnaire_id')
    .eq('id', entrepriseLogistiqueId)
    .maybeSingle();
  return data?.gestionnaire_id || null;
}

async function resolveDriverUserId(db, livraison) {
  if (!livraison?.livreur_id) return null;
  const { data } = await db
    .from('livreurs')
    .select('utilisateur_id')
    .eq('id', livraison.livreur_id)
    .maybeSingle();
  return data?.utilisateur_id || null;
}

async function markSousCommandeReglee(db, sousCommandeId) {
  const now = new Date().toISOString();
  const { error } = await db
    .from('sous_commandes')
    .update({ reglee_at: now, updated_at: now })
    .eq('id', sousCommandeId);
  if (error && !String(error.message || '').includes('reglee_at')) {
    throw error;
  }
}

async function markCommandeEscrowCredited(db, commandeId) {
  const now = new Date().toISOString();
  const { error } = await db
    .from('commandes')
    .update({ escrow_credite_at: now, updated_at: now })
    .eq('id', commandeId);
  if (error && !String(error.message || '').includes('escrow_credite_at')) {
    throw error;
  }
}

async function getEstablishmentOwnerId(db, sc) {
  if (sc.restaurant_id) {
    const { data } = await db
      .from('restaurants')
      .select('proprietaire_id')
      .eq('id', sc.restaurant_id)
      .maybeSingle();
    return data?.proprietaire_id || null;
  }
  if (sc.boutique_id) {
    const { data } = await db
      .from('boutiques')
      .select('proprietaire_id')
      .eq('id', sc.boutique_id)
      .maybeSingle();
    return data?.proprietaire_id || null;
  }
  return null;
}

async function resolveDeliveryFeeForLivraison(db, livraison) {
  if (livraison.sous_commande_id) {
    const { data: sc } = await db
      .from('sous_commandes')
      .select('frais_livraison')
      .eq('id', livraison.sous_commande_id)
      .maybeSingle();
    if (sc?.frais_livraison != null) return Number(sc.frais_livraison);
  }
  const snap = livraison.adresse_livraison_snapshot;
  if (snap && typeof snap === 'object' && snap.montant_livraison != null) {
    return Number(snap.montant_livraison);
  }
  return Number(livraison.commission_logistique ?? 0) + Number(livraison.montant_livreur ?? 0);
}

async function listTransactionsForUser(db, utilisateurId, { limit = 40 } = {}) {
  return walletService.listTransactions(db, utilisateurId, { limit });
}

async function getWalletDashboard(db, utilisateurId) {
  const [solde, transactions, retraits] = await Promise.all([
    walletService.getSolde(db, utilisateurId),
    walletService.listTransactions(db, utilisateurId, { limit: 25 }),
    withdrawalRepo.listForUser(db, utilisateurId, { limit: 15 }),
  ]);
  return {
    portefeuille_id: solde.portefeuilleId,
    solde_fcfa: solde.soldeFcfa,
    solde_en_attente_fcfa: solde.soldeEnAttenteFcfa,
    devise: solde.devise,
    transactions,
    retraits,
  };
}

const MIN_RETRAIT_FCFA = withdrawalService.MIN_WITHDRAW_FCFA;

async function createWithdrawalRequest(db, utilisateurId, payload, { role } = {}) {
  const { normalizeWithdrawalRequest } = require('../payments/dto/payout.dto');
  const normalized = normalizeWithdrawalRequest(payload || {});
  return withdrawalService.createRequest(db, utilisateurId, normalized, { role });
}

async function listWithdrawalsAdmin(db, { statut } = {}) {
  return withdrawalRepo.listAll(db, { statut });
}

async function processWithdrawalAdmin(db, retraitId, adminUserId, { action, note_admin: noteAdmin } = {}) {
  if (action === 'rejeter' || action === 'reject') {
    return withdrawalService.rejectWithdrawal(db, retraitId, adminUserId, { motif: noteAdmin });
  }
  if (action === 'approuver' || action === 'approve' || action === 'payer' || action === 'pay') {
    return withdrawalService.processWithdrawal(db, retraitId, { source: 'admin' });
  }
  throw createHttpError(400, 'Action invalide (approuver, rejeter).');
}

async function getPlatformWalletAdmin(db) {
  const golivraUserId = await escrowService.resolveGolivraPlatformUserId(db);
  const dashboard = await getWalletDashboard(db, golivraUserId);
  // legacy : récupère les transactions + commissions
  const tx = await walletService.listTransactions(db, golivraUserId, { limit: 100 });
  let commissionsLivraison = 0;
  let commissionsMois = 0;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  for (const t of tx) {
    if (t.type === 'commission_golivra') {
      commissionsLivraison += t.montantFcfa;
      if (new Date(t.creeLe) >= monthStart) commissionsMois += t.montantFcfa;
    }
  }
  const pending = await withdrawalRepo.listEnAttente(db, { limit: 100 });
  const retraitsEnAttente = pending.reduce((acc, w) => acc + w.montantFcfa, 0);
  return {
    ...dashboard,
    role: 'plateforme_golivra',
    commissions_livraison_total_fcfa: commissionsLivraison,
    commissions_livraison_mois_fcfa: commissionsMois,
    retraits_en_attente_fcfa: retraitsEnAttente,
    nb_retraits_en_attente: pending.length,
    message: 'Revenus GoLivra = part plateforme sur les frais de livraison uniquement (pas de commission sur les ventes).',
  };
}

async function getPortefeuilleSolde(db, utilisateurId) {
  const r = await walletService.getSolde(db, utilisateurId);
  return r.soldeFcfa;
}

module.exports = {
  // Nouvelles fonctions (délèguent au module payments/)
  getOrCreatePortefeuille,
  creditWallet,
  debitWallet,
  holdOrderPaymentInEscrow,
  creditVendorsOnOrderPaid,
  settleSousCommandePayout,
  settleDeliveryFeesOnComplete,
  resolveDeliveryCommissionPercent,
  getPortefeuilleSolde,
  getWalletDashboard,
  listTransactionsForUser,
  createWithdrawalRequest,
  listWithdrawalsAdmin,
  processWithdrawalAdmin,
  getPlatformWalletAdmin,
  // helpers legacy
  resolveGolivraPlatformUserId,
  hasWalletTransaction,
  resolveLogisticsGestionnaireId,
  resolveDriverUserId,
  markSousCommandeReglee,
  markCommandeEscrowCredited,
  getEstablishmentOwnerId,
  resolveDeliveryFeeForLivraison,
  MIN_RETRAIT_FCFA,
};
