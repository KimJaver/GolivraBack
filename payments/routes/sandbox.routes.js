/**
 * Routes — Sandbox admin (gestion des scénarios PawaPay)
 * Base : /api/admin/sandbox
 */

const express = require('express');
const { authMiddleware } = require('../../middlewares/auth.middleware');
const { requireRoles } = require('../../middlewares/role.middleware');
const {
  getActive,
  listAvailable,
  listAllActive,
  setScenario,
  clearScenario,
} = require('../controllers/sandbox.controller');

const router = express.Router();
const adminOnly = requireRoles(['admin']);

router.get('/sandbox/scenarios', authMiddleware, adminOnly, listAvailable);
router.get('/sandbox/scenarios/actifs', authMiddleware, adminOnly, listAllActive);
router.get('/sandbox/scenario', authMiddleware, adminOnly, getActive);
router.post('/sandbox/scenario', authMiddleware, adminOnly, setScenario);
router.delete('/sandbox/scenario', authMiddleware, adminOnly, clearScenario);

module.exports = router;
