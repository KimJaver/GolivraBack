/**
 * Routes — Payouts / Wallet (utilisateur)
 * Base : /api/payouts
 *        /api/wallet
 */

const express = require('express');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { requireRoles } = require('../../middlewares/role.middleware');
const {
  createWithdrawal,
  listMyWithdrawals,
  getWithdrawal,
  getWithdrawalInfo,
} = require('../controllers/payout.controller');

const router = express.Router();

const walletRoles = [
  'client',
  'restaurateur',
  'commercant',
  'livreur',
  'gestionnaire_logistique',
  'admin',
];

// Payouts (nouveau endpoint propre, complémentaire de /api/wallet/* legacy)
router.get('/payouts/info', authMiddleware, getWithdrawalInfo);
router.get('/payouts', authMiddleware, requireRoles(walletRoles), listMyWithdrawals);
router.get('/payouts/:withdrawalId', authMiddleware, requireRoles(walletRoles), getWithdrawal);
router.post('/payouts', authMiddleware, requireRoles(walletRoles), createWithdrawal);

module.exports = router;
