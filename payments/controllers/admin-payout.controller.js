/**
 * Controller — Admin Payout
 * Modération et gestion des retraits / plateforme.
 */

const { getDb } = require('../../config/db');
const { createHttpError, requireFields } = require('../../utils/http');
const withdrawalService = require('../services/withdrawal.service');
const withdrawalRepo = require('../repositories/withdrawal.repository');
const walletRepo = require('../repositories/wallet.repository');
const escrowRepo = require('../repositories/escrow.repository');
const ledgerRepo = require('../repositories/ledger.repository');
const { withdrawalResponse } = require('../dto/payout.dto');

async function listAllWithdrawals(req, res, next) {
  try {
    const db = getDb();
    const statut = typeof req.query.statut === 'string' ? req.query.statut.trim() : '';
    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const list = await withdrawalRepo.listAll(db, { statut: statut || undefined, limit });
    // Hydrate avec les utilisateurs
    const userIds = [...new Set(list.map((w) => w.utilisateurId))];
    let users = [];
    if (userIds.length) {
      const { data } = await db.from('utilisateurs').select('id, nom, telephone, email').in('id', userIds);
      users = data || [];
    }
    const userMap = new Map(users.map((u) => [u.id, u]));
    return res.json(list.map((w) => ({
      ...withdrawalResponse(w),
      utilisateur: userMap.get(w.utilisateurId) || null,
    })));
  } catch (err) {
    return next(err);
  }
}

async function approveWithdrawal(req, res, next) {
  try {
    const { withdrawalId } = req.params;
    const db = getDb();
    const w = await withdrawalService.processWithdrawal(db, withdrawalId, { source: 'admin' });
    return res.json(withdrawalResponse(w.withdrawal));
  } catch (err) {
    return next(err);
  }
}

async function rejectWithdrawal(req, res, next) {
  try {
    const { withdrawalId } = req.params;
    const motif = req.body?.motif || req.body?.note_admin || null;
    const db = getDb();
    const w = await withdrawalService.rejectWithdrawal(db, withdrawalId, req.auth.userId, { motif });
    return res.json(withdrawalResponse(w));
  } catch (err) {
    return next(err);
  }
}

async function getPlatformWallet(req, res, next) {
  try {
    const db = getDb();
    const golivraUserId = await require('../services/escrow.service').resolveGolivraPlatformUserId(db);
    const w = await walletRepo.findByUtilisateur(db, golivraUserId);
    if (!w) return res.json({ portefeuille: null });

    const [tx, lg] = await Promise.all([
      require('../repositories/transaction.repository').listForPortefeuille(db, w.id, { limit: 25 }),
      ledgerRepo.listForPortefeuille(db, w.id, { limit: 25 }),
    ]);

    // Stats commissions
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    let commissionsMoisFcfa = 0;
    let commissionsTotalFcfa = 0;
    for (const e of lg) {
      if (e.type === 'commission') {
        commissionsTotalFcfa += e.montantFcfa;
        if (new Date(e.creeLe) >= monthStart) commissionsMoisFcfa += e.montantFcfa;
      }
    }

    // Escrows en cours
    const escrowsBloques = await escrowRepo.listEnAttente(db, { limit: 100 });
    const totalEscrowBloqueFcfa = escrowsBloques.reduce((acc, e) => acc + e.montantFcfa, 0);

    // Retraits en attente
    const pendingRetraits = await withdrawalRepo.listEnAttente(db, { limit: 100 });
    const retraitsEnAttenteFcfa = pendingRetraits.reduce((acc, w2) => acc + w2.montantFcfa, 0);

    return res.json({
      portefeuille: w,
      transactions: tx,
      ledger: lg,
      stats: {
        commissions_total_fcfa: commissionsTotalFcfa,
        commissions_mois_fcfa: commissionsMoisFcfa,
        escrow_bloque_fcfa: totalEscrowBloqueFcfa,
        retraits_en_attente_fcfa: retraitsEnAttenteFcfa,
        nb_retraits_en_attente: pendingRetraits.length,
      },
    });
  } catch (err) {
    return next(err);
  }
}

async function listEscrows(req, res, next) {
  try {
    const db = getDb();
    const statut = typeof req.query.statut === 'string' ? req.query.statut.trim() : '';
    let escrows = [];
    if (statut && ['en_attente', 'bloque'].includes(statut)) {
      escrows = await escrowRepo.listEnAttente(db, { limit: 200 });
    } else {
      const { data } = await db.from('escrows').select('*').order('created_at', { ascending: false }).limit(200);
      escrows = (data || []).map((row) => ({
        id: row.id,
        commandeId: row.commande_id,
        restaurantId: row.restaurant_id,
        boutiqueId: row.boutique_id,
        montantFcfa: Number(row.montant),
        commissionTtcFcfa: Number(row.commission_ttc),
        statut: row.statut,
        creeLe: row.created_at,
        libereAt: row.libere_at,
        rembourseAt: row.rembourse_at,
      }));
    }
    return res.json(escrows);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  getPlatformWallet,
  listEscrows,
};
