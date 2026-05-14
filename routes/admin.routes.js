const express = require('express');
const {
  createCourier,
  listEnterprisesPending,
  activateEnterprise,
  suspendEnterprise,
} = require('../controllers/admin.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

const router = express.Router();

router.post('/couriers', authMiddleware, requireRoles(['admin']), createCourier);
router.get('/enterprises/pending', authMiddleware, requireRoles(['admin']), listEnterprisesPending);
router.patch('/enterprises/:enterpriseId/activate', authMiddleware, requireRoles(['admin']), activateEnterprise);
router.patch('/enterprises/:enterpriseId/suspend', authMiddleware, requireRoles(['admin']), suspendEnterprise);

module.exports = router;
