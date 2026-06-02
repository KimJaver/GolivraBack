/**
 * Service — Withdrawals + Payout
 *
 * Cycle de vie :
 *   1. Le client (ou commerce / livreur) demande un retrait
 *      → createRequest()   : crée un `withdrawals` en `en_attente`,
 *                            réserve le montant (solde_en_attente)
 *   2. Le système le prend en charge
 *      → process()         : passe en `en_traitement`, crée un payout PawaPay
 *   3. PawaPay confirme
 *      → complete()        : statut `reussi` + débit réel du wallet
 *      → fail()            : statut `echoue` + libération de la réservation
 *
 * Règle d'or : l'argent n'est JAMAIS débité du solde tant que PawaPay n'a
 * pas confirmé. On passe par `solde_en_attente` pour réserver visuellement.
 */

const withdrawalRepo = require('../repositories/withdrawal.repository');
const walletRepo = require('../repositories/wallet.repository');
const wallet = require('./wallet.service');
const pawapay = require('./pawapay.service');
const ledger = require('./ledger.service');
const { createHttpError } = require('../../utils/http');
const { info: logInfo, warn: logWarn, error: logError } = require('../../utils/logger');

const AUTO_APPROVE_ROLES = new Set([
  'restaurateur',
  'commercant',
  'livreur',
  'gestionnaire_logistique',
]);

const MIN_WITHDRAW_FCFA = Number(process.env.MIN_RETRAIT_FCFA) || 500;
const MAX_WITHDRAW_FCFA = Number(process.env.PAYOUT_MAX_FCFA) || 5_000_000;
const RETRY_MAX = Number(process.env.PAYOUT_RETRY_MAX) || 3;

function newPayoutId() {
  const r = Math.random().toString(36).slice(2, 10);
  return `pw_${Date.now()}_${r}`;
}

/**
 * Crée une demande de retrait.
 *
 * - Auto-approuve (et lance le payout) pour les rôles AUTO_APPROVE_ROLES.
 * - Pour les clients / admin : statut `en_attente`, modération admin requise.
 */
async function createRequest(db, utilisateurId, payload, { role = null } = {}) {
  const montant = Number(payload.montantFcfa);
  if (!Number.isFinite(montant) || montant <= 0) {
    throw createHttpError(400, 'Montant invalide.');
  }
  const isPlatformAdmin = role === 'admin';
  const autoApprove = AUTO_APPROVE_ROLES.has(role) || isPlatformAdmin;
  const min = autoApprove ? 1 : MIN_WITHDRAW_FCFA;
  if (montant < min) {
    throw createHttpError(400, `Montant minimum de retrait : ${min} FCFA.`);
  }
  if (montant > MAX_WITHDRAW_FCFA) {
    throw createHttpError(400, `Montant maximum : ${MAX_WITHDRAW_FCFA} FCFA.`);
  }
  if (!payload.numeroCompte || payload.numeroCompte.length < 8) {
    throw createHttpError(400, 'Numéro Mobile Money invalide.');
  }

  const pf = await wallet.getOrCreate(db, utilisateurId);
  const solde = Number(pf.soldeFcfa ?? 0);
  const enAttente = Number(pf.soldeEnAttenteFcfa ?? 0);
  const disponible = Math.max(0, solde - enAttente);
  if (disponible < montant) {
    throw createHttpError(400, 'Solde insuffisant.');
  }

  // Refuse les doublons en attente
  if (!autoApprove) {
    const pending = await withdrawalRepo.listEnAttente(db, { limit: 50 });
    const hasPending = (pending || []).some((w) => w.utilisateurId === utilisateurId);
    if (hasPending) {
      throw createHttpError(409, 'Vous avez déjà une demande de retrait en attente.');
    }
  }

  const withdrawal = await withdrawalRepo.create(db, {
    portefeuilleId: pf.id,
    utilisateurId,
    montantFcfa: montant,
    devise: pf.devise || 'XAF',
    methode: payload.methode || 'airtel_money',
    numeroCompte: payload.numeroCompte,
    nomBeneficiaire: payload.nomBeneficiaire || null,
    noteDemandeur: payload.noteDemandeur || null,
    statut: 'en_attente',
  });

  // Réserve le montant en "solde_en_attente" pour qu'il ne soit pas redépensé
  await walletRepo.updateSolde(db, pf.id, {
    soldeEnAttente: enAttente + montant,
  });

  // Auto-approuve : passe en en_traitement et lance le payout
  if (autoApprove) {
    return processWithdrawal(db, withdrawal.id, { source: 'auto' });
  }

  return withdrawal;
}

/**
 * Lance le payout PawaPay pour un withdrawal.
 * - Statut en_attente → en_traitement
 * - Crée un pawapay_payouts
 * - Appelle PawaPay (live ou simulation)
 */
async function processWithdrawal(db, withdrawalId, { source = 'manual' } = {}) {
  const withdrawal = await withdrawalRepo.findById(db, withdrawalId);
  if (!withdrawal) throw createHttpError(404, 'Demande de retrait introuvable.');
  if (withdrawal.statut !== 'en_attente') {
    return { withdrawal, dejaEnCours: true };
  }

  // Anti-doublon payout : on n'a pas encore de payoutId
  if (withdrawal.payoutId) {
    return { withdrawal, dejaEnCours: true };
  }

  // Si on a déjà un pawapay_payouts "soumis" → on attend le webhook
  const existingPayout = await withdrawalRepo.findPayoutByWithdrawalId(db, withdrawalId);
  if (existingPayout && ['soumis', 'en_traitement'].includes(existingPayout.statut)) {
    return { withdrawal, dejaEnCours: true };
  }

  // Bascule en en_traitement
  const updated = await withdrawalRepo.update(db, withdrawalId, {
    statut: 'en_traitement',
    tentatives: Number(withdrawal.tentatives || 0) + 1,
  });

  // Prépare l'appel PawaPay
  const payoutId = newPayoutId();
  const requestPayload = {
    payoutId,
    amount: String(Number(withdrawal.montantFcfa).toFixed(2)),
    currency: withdrawal.devise || 'XAF',
    correspondent: pawapay.countryToCorrespondent('CG', withdrawal.methode),
    recipient: {
      type: 'MSISDN',
      address: { value: pawapay.normalizePhone(withdrawal.numeroCompte) },
    },
    customerMessage: 'GoLivra retrait',
    metadata: [
      { fieldName: 'withdrawalId', fieldValue: withdrawalId },
      { fieldName: 'utilisateurId', fieldValue: withdrawal.utilisateurId },
    ],
  };

  const payoutRow = await withdrawalRepo.createPayout(db, {
    withdrawalId,
    payoutId,
    statut: 'en_attente',
    montantFcfa: Number(withdrawal.montantFcfa),
    devise: withdrawal.devise,
    methode: withdrawal.methode,
    numeroCompte: withdrawal.numeroCompte,
    pays: 'CG',
    correspondant: requestPayload.correspondant,
    requestPayload,
  });

  // Appel API PawaPay
  let apiResponse;
  try {
    apiResponse = await pawapay.initiatePayout({
      payoutId,
      montantFcfa: Number(withdrawal.montantFcfa),
      currency: withdrawal.devise,
      methode: withdrawal.methode,
      numeroCompte: withdrawal.numeroCompte,
      pays: 'CG',
      nomBeneficiaire: withdrawal.nomBeneficiaire,
      metadata: requestPayload.metadata,
      sandboxContext: {
        utilisateurId: withdrawal.utilisateurId,
      },
    });
  } catch (err) {
    apiResponse = { ok: false, error: err.message };
  }

  const now = new Date().toISOString();
  if (apiResponse?.ok) {
    if (apiResponse.simulated) {
      // Mode simulation → on bascule directement en "soumis" et on simule la complétion
      await withdrawalRepo.updatePayout(db, payoutRow.id, {
        statut: 'soumis',
        soumis_at: now,
        response_payload: { simulated: true, source },
      });
      await withdrawalRepo.update(db, withdrawalId, { payout_id: payoutId });
      // En simulation on complète tout de suite pour que le dev voie le flux
      return completeWithdrawal(db, withdrawalId, { simulated: true });
    }
    await withdrawalRepo.updatePayout(db, payoutRow.id, {
      statut: 'soumis',
      soumis_at: now,
      response_payload: apiResponse.data || null,
    });
    await withdrawalRepo.update(db, withdrawalId, { payout_id: payoutId });
  } else {
    await withdrawalRepo.updatePayout(db, payoutRow.id, {
      statut: 'echoue',
      termine_at: now,
      erreur: apiResponse?.error || 'pawapay_error',
      response_payload: apiResponse?.body || null,
    });
    return failWithdrawal(db, withdrawalId, apiResponse?.error || 'PawaPay injoignable');
  }

  return {
    withdrawal: await withdrawalRepo.findById(db, withdrawalId),
    payout: await withdrawalRepo.findPayoutByPayoutId(db, payoutId),
  };
}

/**
 * Confirme un withdrawal (webhook PawaPay COMPLETED ou simulation).
 * - Statut → reussi
 * - Débite le wallet (solde ET solde_en_attente)
 * - Écrit la ligne ledger 'payout'
 */
async function completeWithdrawal(db, withdrawalId, { payoutId = null, simulated = false } = {}) {
  const withdrawal = withdrawalId
    ? await withdrawalRepo.findById(db, withdrawalId)
    : await withdrawalRepo.findByPayoutId(db, payoutId);
  if (!withdrawal) throw createHttpError(404, 'Demande de retrait introuvable.');
  if (withdrawal.statut === 'reussi') return { withdrawal, dejaReussi: true };
  if (withdrawal.statut === 'echoue' || withdrawal.statut === 'rejete' || withdrawal.statut === 'annule') {
    throw createHttpError(409, `Retrait dans l'état "${withdrawal.statut}" ne peut être marqué réussi.`);
  }

  // 1. Débite le wallet (crée transaction_portefeuille + ledger)
  const { wallet: updatedWallet, ledger: ledgerEntry } = await wallet.debit(
    db,
    withdrawal.utilisateurId,
    Number(withdrawal.montantFcfa),
    {
      type: 'debit',
      ledgerType: 'payout',
      referenceType: 'withdrawal',
      referenceId: withdrawal.id,
      description: `Retrait ${withdrawal.methode} → ${withdrawal.numeroCompte}`,
      metadata: { payoutId: payoutId || withdrawal.payoutId, simulated },
    },
  );

  // 2. Libère la réservation solde_en_attente
  const newEnAttente = Math.max(0, Number(updatedWallet.soldeEnAttenteFcfa ?? 0) - Number(withdrawal.montantFcfa));
  await walletRepo.updateSolde(db, updatedWallet.id, { soldeEnAttente: newEnAttente });

  // 3. Statut withdrawal
  const now = new Date().toISOString();
  const updated = await withdrawalRepo.update(db, withdrawal.id, {
    statut: 'reussi',
    processed_at: now,
    traite_at: now,
  });

  // 4. Met à jour le payout row
  if (payoutId) {
    const payoutRow = await withdrawalRepo.findPayoutByPayoutId(db, payoutId);
    if (payoutRow) {
      await withdrawalRepo.updatePayout(db, payoutRow.id, {
        statut: 'reussi',
        termine_at: now,
      });
    }
  }

  return { withdrawal: updated, ledger: ledgerEntry };
}

/**
 * Marque un withdrawal comme échoué (webhook FAILED / REJECTED ou erreur API).
 * - Statut → echoue
 * - Libère la réservation solde_en_attente (l'argent retourne dans le solde dispo)
 */
async function failWithdrawal(db, withdrawalId, raison = 'Payout échoué') {
  const withdrawal = withdrawalId
    ? await withdrawalRepo.findById(db, withdrawalId)
    : null;
  if (!withdrawal) throw createHttpError(404, 'Demande de retrait introuvable.');
  if (withdrawal.statut === 'echoue' || withdrawal.statut === 'rejete' || withdrawal.statut === 'annule') {
    return { withdrawal, dejaEnEchec: true };
  }

  // Libère la réservation
  const pf = await walletRepo.findByUtilisateur(db, withdrawal.utilisateurId);
  if (pf) {
    const newEnAttente = Math.max(0, Number(pf.soldeEnAttenteFcfa ?? 0) - Number(withdrawal.montantFcfa));
    await walletRepo.updateSolde(db, pf.id, { soldeEnAttente: newEnAttente });
  }

  const now = new Date().toISOString();
  const updated = await withdrawalRepo.update(db, withdrawal.id, {
    statut: 'echoue',
    motif_rejet: raison,
    processed_at: now,
  });

  // Met à jour le payout row si présent
  const payoutRow = await withdrawalRepo.findPayoutByWithdrawalId(db, withdrawal.id);
  if (payoutRow && !['reussi', 'echoue'].includes(payoutRow.statut)) {
    await withdrawalRepo.updatePayout(db, payoutRow.id, {
      statut: 'echoue',
      termine_at: now,
      erreur: raison,
    });
  }

  return { withdrawal: updated };
}

/**
 * Rejette manuellement un withdrawal (admin).
 */
async function rejectWithdrawal(db, withdrawalId, adminUserId, { motif = null } = {}) {
  const withdrawal = await withdrawalRepo.findById(db, withdrawalId);
  if (!withdrawal) throw createHttpError(404, 'Demande de retrait introuvable.');
  if (withdrawal.statut !== 'en_attente') {
    throw createHttpError(409, 'Cette demande a déjà été traitée.');
  }
  // Libère la réservation
  const pf = await walletRepo.findByUtilisateur(db, withdrawal.utilisateurId);
  if (pf) {
    const newEnAttente = Math.max(0, Number(pf.soldeEnAttenteFcfa ?? 0) - Number(withdrawal.montantFcfa));
    await walletRepo.updateSolde(db, pf.id, { soldeEnAttente: newEnAttente });
  }
  const now = new Date().toISOString();
  const updated = await withdrawalRepo.update(db, withdrawal.id, {
    statut: 'rejete',
    motif_rejet: motif || 'Rejeté par admin',
    traite_par: adminUserId,
    traite_at: now,
  });
  return updated;
}

/**
 * Récupère un withdrawal par payoutId (webhook PawaPay).
 */
async function findByPayoutId(db, payoutId) {
  return withdrawalRepo.findByPayoutId(db, payoutId);
}

module.exports = {
  createRequest,
  processWithdrawal,
  completeWithdrawal,
  failWithdrawal,
  rejectWithdrawal,
  findByPayoutId,
  MIN_WITHDRAW_FCFA,
  MAX_WITHDRAW_FCFA,
  RETRY_MAX,
};
