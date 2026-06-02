/**
 * Service — Escrow
 * Cycle de vie :
 *   hold()      -> crée un escrow 'bloque' et crédite le wallet plateforme
 *   release()   -> débloque, débite le wallet plateforme, et l'argent va
 *                  au marchand (vente) et au livreur (livraison - commission)
 *   refund()    -> débloque, débite le wallet plateforme et rembourse le client
 *   cancel()    -> annule (par ex. commande annulée avant paiement)
 *
 * Toutes les opérations sont idempotentes : un même appel avec le même
 * `referenceId` ne produit pas de double mouvement.
 */

const escrowRepo = require('../repositories/escrow.repository');
const commission = require('./commission.service');
const wallet = require('./wallet.service');
const ledger = require('./ledger.service');
const paymentRepo = require('../repositories/payment.repository');
const { createHttpError } = require('../../utils/http');
const { info: logInfo, warn: logWarn, error: logError } = require('../../utils/logger');

const LEDGER_TYPE_RELEASE = {
  merchant: 'sale_credit',
  delivery: 'delivery_credit',
  commission: 'commission',
};
const GOLIVRA_PLATFORM_EMAIL = process.env.GOLIVRA_PLATFORM_EMAIL || 'golivra@gmail.com';

let cachedGolivraUserId = null;

async function resolveGolivraPlatformUserId(db) {
  if (process.env.GOLIVRA_PLATFORM_USER_ID) return process.env.GOLIVRA_PLATFORM_USER_ID;
  if (cachedGolivraUserId) return cachedGolivraUserId;

  const { data: byEmail } = await db
    .from('utilisateurs')
    .select('id')
    .ilike('email', GOLIVRA_PLATFORM_EMAIL)
    .maybeSingle();
  if (byEmail?.id) {
    cachedGolivraUserId = byEmail.id;
    return byEmail.id;
  }

  const { data: role } = await db.from('roles').select('id').eq('nom', 'admin').maybeSingle();
  if (role?.id) {
    const { data: admin } = await db
      .from('utilisateurs')
      .select('id')
      .eq('role_id', role.id)
      .eq('est_actif', true)
      .limit(1)
      .maybeSingle();
    if (admin?.id) {
      cachedGolivraUserId = admin.id;
      return admin.id;
    }
  }
  throw createHttpError(500, 'Compte portefeuille GoLivra introuvable.');
}

/**
 * Récupère la config de tarification + l'éventuelle ligne restaurant/boutique.
 */
async function loadConfig(db) {
  const { getPricingConfig } = require('../../services/pricing.service');
  return getPricingConfig(db);
}

async function loadEtablissement(db, { restaurantId, boutiqueId }) {
  if (restaurantId) {
    const { data } = await db.from('restaurants').select('*').eq('id', restaurantId).maybeSingle();
    return data || null;
  }
  if (boutiqueId) {
    const { data } = await db.from('boutiques').select('*').eq('id', boutiqueId).maybeSingle();
    return data || null;
  }
  return null;
}

async function getSousCommandes(db, commandeId) {
  const { data, error } = await db
    .from('sous_commandes')
    .select('id, restaurant_id, boutique_id, sous_total, frais_livraison, total, statut, numero, reglee_at')
    .eq('commande_id', commandeId);
  if (error) throw error;
  return data || [];
}

async function getOwnerIdForSousCommande(db, sc) {
  if (sc.restaurant_id) {
    const { data } = await db.from('restaurants').select('proprietaire_id').eq('id', sc.restaurant_id).maybeSingle();
    return data?.proprietaire_id || null;
  }
  if (sc.boutique_id) {
    const { data } = await db.from('boutiques').select('proprietaire_id').eq('id', sc.boutique_id).maybeSingle();
    return data?.proprietaire_id || null;
  }
  return null;
}

async function getDriverUserId(db, livraison) {
  if (!livraison?.livreur_id) return null;
  const { data } = await db.from('livreurs').select('utilisateur_id').eq('id', livraison.livreur_id).maybeSingle();
  return data?.utilisateur_id || null;
}

async function getLogisticsGestionnaire(db, entrepriseId) {
  if (!entrepriseId) return null;
  const { data } = await db.from('entreprises_logistiques').select('gestionnaire_id, commission_pct').eq('id', entrepriseId).maybeSingle();
  return data || null;
}

/**
 * Mise en escrow d'un paiement validé.
 * Crée un (ou plusieurs) escrow(s) — un par sous-commande — et crédite le
 * wallet plateforme. Si la commande a une seule sous-commande, on garde
 * une seule ligne d'escrow pour simplifier l'audit.
 *
 * @param {object} db
 * @param {string} commandeId
 * @param {string} paiementId
 * @param {{ totalCommande?: number, sousCommandes?: object[] }} [opts]
 * @returns {Promise<{ escrows: object[], totalBloqueFcfa: number }>}
 */
async function hold(db, commandeId, paiementId, opts = {}) {
  const { data: commande, error } = await db
    .from('commandes')
    .select('id, total, escrow_credite_at')
    .eq('id', commandeId)
    .maybeSingle();
  if (error) throw error;
  if (!commande) throw createHttpError(404, 'Commande introuvable.');

  if (commande.escrow_credite_at) {
    return { escrows: [], totalBloqueFcfa: 0, dejaBloque: true };
  }

  const config = await loadConfig(db);
  const sousCommandes = opts.sousCommandes || (await getSousCommandes(db, commandeId));
  if (sousCommandes.length === 0) {
    throw createHttpError(400, 'Aucune sous-commande pour mettre en escrow.');
  }

  const totalCommande = Number(opts.totalCommande ?? commande.total ?? 0);
  const golivraUserId = await resolveGolivraPlatformUserId(db);
  const created = [];
  let totalBloque = 0;

  for (const sc of sousCommandes) {
    const scTotal = Number(sc.total ?? 0);
    const etablissement = await loadEtablissement(db, sc);
    const breakdown = commission.computeBreakdown({
      sousTotal: Number(sc.sous_total ?? 0),
      fraisLivraison: Number(sc.frais_livraison ?? 0),
      etablissement,
      config,
    });

    const escrow = await escrowRepo.create(db, {
      commandeId,
      paiementId,
      restaurantId: sc.restaurant_id || null,
      boutiqueId: sc.boutique_id || null,
      montantFcfa: scTotal,
      commissionPct: breakdown.taux.ventePct,
      commissionTtcFcfa: breakdown.commissionVenteFcfa,
      montantEtablissementFcfa: breakdown.produitNetFcfa,
      fraisLivraisonFcfa: breakdown.fraisLivraisonFcfa,
      statut: 'bloque',
      metadata: {
        breakdown,
        sousCommandeId: sc.id,
        sousCommandeNumero: sc.numero || null,
      },
    });

    if (scTotal > 0) {
      await wallet.credit(db, golivraUserId, scTotal, {
        type: 'credit',
        ledgerType: 'escrow_hold',
        referenceType: 'escrow',
        referenceId: escrow.id,
        description: `Escrow — sous-commande ${sc.numero || sc.id}`,
        metadata: { commandeId, sousCommandeId: sc.id, breakdown },
      });
    }
    totalBloque += scTotal;
    created.push(escrow);
  }

  // Marque la commande comme « escrow crédité »
  const now = new Date().toISOString();
  const { error: cmdErr } = await db
    .from('commandes')
    .update({ escrow_credite_at: now, updated_at: now })
    .eq('id', commandeId);
  if (cmdErr && !String(cmdErr.message || '').includes('escrow_credite_at')) {
    logWarn({ msg: 'escrow_hold_update_commande', error: cmdErr.message });
  }

  // Lie le paiement à un escrow représentatif (le 1er) pour la FK
  if (paiementId && created[0]) {
    try {
      await paymentRepo.update(db, paiementId, { escrow_id: created[0].id });
    } catch (err) {
      logWarn({ msg: 'escrow_hold_link_paiement', error: err.message });
    }
  }

  return { escrows: created, totalBloqueFcfa: totalBloque, dejaBloque: false, totalCommande };
}

/**
 * Libère un escrow (à la livraison) → débite le wallet plateforme, crédite
 * marchand (vente nette) et livreur / entreprise logistique (frais nets).
 * Idempotent : si déjà libéré, ne fait rien.
 */
async function release(db, escrowId, { livraison = null } = {}) {
  const escrow = await escrowRepo.findById(db, escrowId);
  if (!escrow) throw createHttpError(404, 'Escrow introuvable.');
  if (escrow.statut === 'libere') {
    return { escrow, dejaLibere: true };
  }
  if (escrow.statut !== 'bloque' && escrow.statut !== 'en_attente') {
    throw createHttpError(409, `Escrow dans l'état "${escrow.statut}" ne peut être libéré.`);
  }

  const config = await loadConfig(db);
  const golivraUserId = await resolveGolivraPlatformUserId(db);

  // Récupère la sous-commande associée (si metadata) pour trouver le propriétaire
  let ownerId = null;
  if (escrow.metadata?.sousCommandeId) {
    const { data: sc } = await db
      .from('sous_commandes')
      .select('id, restaurant_id, boutique_id')
      .eq('id', escrow.metadata.sousCommandeId)
      .maybeSingle();
    if (sc) ownerId = await getOwnerIdForSousCommande(db, sc);
  }
  if (!ownerId && (escrow.restaurantId || escrow.boutiqueId)) {
    ownerId = await getOwnerIdForSousCommande(db, {
      restaurant_id: escrow.restaurantId,
      boutique_id: escrow.boutiqueId,
    });
  }

  // Calcul de la répartition (recupère l'entreprise logistique depuis la livraison)
  const entrepriseLogistique = livraison?.entreprise_logistique_id
    ? await getLogisticsGestionnaire(db, livraison.entreprise_logistique_id)
    : null;
  const breakdown = commission.computeBreakdown({
    sousTotal: Number(escrow.montantEtablissementFcfa || 0) + Number(escrow.commissionTtcFcfa || 0),
    fraisLivraison: Number(escrow.fraisLivraisonFcfa || 0),
    etablissement: null,
    entrepriseLogistique,
    config,
  });
  const produitNet = Number(escrow.montantEtablissementFcfa || 0);
  const fraisNet = Number(escrow.fraisLivraisonFcfa || 0) - Number(escrow.fraisLivraisonFcfa || 0) * 0
    - (entrepriseLogistique
        ? Math.round((Number(escrow.fraisLivraisonFcfa || 0) * Number(entrepriseLogistique.commission_pct || breakdown.taux.livraisonPct)) / 100)
        : breakdown.commissionLivraisonFcfa);
  const commissionLivraison = Number(escrow.fraisLivraisonFcfa || 0) - Math.max(0, fraisNet);

  // 1. Débite le wallet plateforme du total escrow (incluant commission)
  const totalADebiter = Number(escrow.montantFcfa || 0);
  if (totalADebiter > 0) {
    try {
      await wallet.debit(db, golivraUserId, totalADebiter, {
        type: 'debit',
        ledgerType: 'escrow_release',
        referenceType: 'escrow',
        referenceId: escrow.id,
        description: `Libération escrow — ${escrow.id}`,
        metadata: { breakdown, ownerId, fraisNet, commissionLivraison },
      });
    } catch (err) {
      logError({ msg: 'escrow_release_debit_plateforme', error: err.message });
      throw err;
    }
  }

  // 2. Crédite le marchand (vente nette)
  if (ownerId && produitNet > 0) {
    await wallet.credit(db, ownerId, produitNet, {
      type: 'credit',
      ledgerType: 'sale_credit',
      referenceType: 'escrow',
      referenceId: escrow.id,
      description: `Vente — escrow ${escrow.id}`,
      metadata: { commissionVente: Number(escrow.commissionTtcFcfa || 0) },
    });
  }

  // 3. Crédite le livreur OU l'entreprise logistique (frais nets)
  if (fraisNet > 0) {
    if (livraison?.livreur_id) {
      const driverUserId = await getDriverUserId(db, livraison);
      if (driverUserId) {
        await wallet.credit(db, driverUserId, fraisNet, {
          type: 'gain_livraison',
          ledgerType: 'delivery_credit',
          referenceType: 'escrow',
          referenceId: escrow.id,
          description: `Livraison — ${fraisNet} FCFA (escrow ${escrow.id})`,
          metadata: { commissionLivraison, commissionPct: breakdown.taux.livraisonPct },
        });
      } else if (entrepriseLogistique?.gestionnaire_id) {
        await wallet.credit(db, entrepriseLogistique.gestionnaire_id, fraisNet, {
          type: 'commission_logistique',
          ledgerType: 'delivery_credit',
          referenceType: 'escrow',
          referenceId: escrow.id,
          description: `Livraison entreprise — ${fraisNet} FCFA`,
        });
      }
    } else if (entrepriseLogistique?.gestionnaire_id) {
      await wallet.credit(db, entrepriseLogistique.gestionnaire_id, fraisNet, {
        type: 'commission_logistique',
        ledgerType: 'delivery_credit',
        referenceType: 'escrow',
        referenceId: escrow.id,
        description: `Livraison entreprise — ${fraisNet} FCFA`,
      });
    }
  }

  // 4. Marque l'escrow libéré
  const now = new Date().toISOString();
  const updated = await escrowRepo.updateStatut(db, escrow.id, 'libere', { libere_at: now });

  // 5. Marque la sous-commande "réglée"
  if (escrow.metadata?.sousCommandeId) {
    const { error: scErr } = await db
      .from('sous_commandes')
      .update({ reglee_at: now, updated_at: now })
      .eq('id', escrow.metadata.sousCommandeId);
    if (scErr && !String(scErr.message || '').includes('reglee_at')) {
      logWarn({ msg: 'escrow_release_update_sc', error: scErr.message });
    }
  }

  return { escrow: updated, produitNet, fraisNet, commissionLivraison };
}

/**
 * Rembourse un escrow (annulation) → débite le wallet plateforme et
 * (futur) lance un payout PawaPay vers le client.
 *
 * Pour l'instant on crédite le wallet interne du client (cas le plus courant :
 * re-credit wallet GoLivra), mais on garde une trace pour payout ultérieur.
 */
async function refund(db, escrowId, { motif = null, payoutClient = false } = {}) {
  const escrow = await escrowRepo.findById(db, escrowId);
  if (!escrow) throw createHttpError(404, 'Escrow introuvable.');
  if (escrow.statut === 'rembourse') return { escrow, dejaRembourse: true };
  if (escrow.statut !== 'bloque' && escrow.statut !== 'en_attente' && escrow.statut !== 'annule') {
    throw createHttpError(409, `Escrow dans l'état "${escrow.statut}" ne peut être remboursé.`);
  }

  const golivraUserId = await resolveGolivraPlatformUserId(db);
  const total = Number(escrow.montantFcfa || 0);

  if (total > 0) {
    try {
      await wallet.debit(db, golivraUserId, total, {
        type: 'debit',
        ledgerType: 'escrow_refund',
        referenceType: 'escrow',
        referenceId: escrow.id,
        description: `Remboursement escrow — ${escrow.id}`,
        metadata: { motif, payoutClient },
      });
    } catch (err) {
      logError({ msg: 'escrow_refund_debit', error: err.message });
      throw err;
    }
  }

  const now = new Date().toISOString();
  const updated = await escrowRepo.updateStatut(db, escrow.id, 'rembourse', { rembourse_at: now });

  // Si on doit reverser au client via son wallet interne :
  if (!payoutClient) {
    const { data: commande } = await db
      .from('commandes')
      .select('client_id')
      .eq('id', escrow.commandeId)
      .maybeSingle();
    if (commande?.client_id && total > 0) {
      await wallet.credit(db, commande.client_id, total, {
        type: 'remboursement',
        ledgerType: 'escrow_refund',
        referenceType: 'escrow',
        referenceId: escrow.id,
        description: `Remboursement commande — ${escrow.commandeId}`,
        metadata: { motif },
      });
    }
  }

  return { escrow: updated, montantFcfa: total, motif };
}

/**
 * Annule un escrow en attente (jamais crédité).
 */
async function cancel(db, escrowId, { motif = null } = {}) {
  const escrow = await escrowRepo.findById(db, escrowId);
  if (!escrow) throw createHttpError(404, 'Escrow introuvable.');
  if (escrow.statut === 'annule') return { escrow, dejaAnnule: true };
  if (escrow.statut !== 'en_attente') {
    throw createHttpError(409, `Escrow dans l'état "${escrow.statut}" ne peut être annulé.`);
  }
  const now = new Date().toISOString();
  const updated = await escrowRepo.updateStatut(db, escrow.id, 'annule', { annule_at: now });
  return { escrow: updated, motif };
}

/**
 * Libère tous les escrows actifs d'une commande.
 */
async function releaseAllForCommande(db, commandeId, { livraison = null } = {}) {
  const escrows = await escrowRepo.findByCommande(db, commandeId);
  const results = [];
  for (const e of escrows) {
    if (e.statut !== 'bloque' && e.statut !== 'en_attente') continue;
    try {
      // Cherche la livraison correspondante si non fournie
      let liv = livraison;
      if (!liv && e.metadata?.sousCommandeId) {
        const { data: found } = await db
          .from('livraisons')
          .select('*')
          .eq('sous_commande_id', e.metadata.sousCommandeId)
          .maybeSingle();
        liv = found || null;
      }
      const r = await release(db, e.id, { livraison: liv });
      results.push(r);
    } catch (err) {
      logError({ msg: 'releaseAllForCommande', escrowId: e.id, error: err.message });
    }
  }
  return results;
}

/**
 * Rembourse tous les escrows actifs d'une commande.
 */
async function refundAllForCommande(db, commandeId, { motif = null, payoutClient = false } = {}) {
  const escrows = await escrowRepo.findByCommande(db, commandeId);
  const results = [];
  for (const e of escrows) {
    if (e.statut === 'rembourse' || e.statut === 'annule') continue;
    try {
      const r = await refund(db, e.id, { motif, payoutClient });
      results.push(r);
    } catch (err) {
      logError({ msg: 'refundAllForCommande', escrowId: e.id, error: err.message });
    }
  }
  return results;
}

module.exports = {
  resolveGolivraPlatformUserId,
  hold,
  release,
  refund,
  cancel,
  releaseAllForCommande,
  refundAllForCommande,
  // helpers (exposed for tests / jobs)
  loadConfig,
  getSousCommandes,
  getOwnerIdForSousCommande,
  getDriverUserId,
  getLogisticsGestionnaire,
};
