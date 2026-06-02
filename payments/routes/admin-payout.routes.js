/**
 * Routes — Admin (modération retraits + wallet plateforme)
 * Base : /api/admin/payouts
 *        /api/admin/wallet
 *        /api/admin/escrows
 */

const express = require('express');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { requireRoles } = require('../../middlewares/role.middleware');
const {
  listAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  getPlatformWallet,
  listEscrows,
} = require('../controllers/admin-payout.controller');

const router = express.Router();

const adminOnly = requireRoles(['admin']);

router.get('/payouts', authMiddleware, adminOnly, listAllWithdrawals);
router.patch('/payouts/:withdrawalId/approve', authMiddleware, adminOnly, approveWithdrawal);
router.patch('/payouts/:withdrawalId/reject', authMiddleware, adminOnly, rejectWithdrawal);

router.get('/wallet/platform', authMiddleware, adminOnly, getPlatformWallet);
router.get('/escrows', authMiddleware, adminOnly, listEscrows);

module.exports = router;
