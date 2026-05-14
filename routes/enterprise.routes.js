const express = require('express');
const {
  listEnterprises,
  getEnterpriseById,
  createEnterprise,
  getMyEnterprises,
} = require('../controllers/enterprise.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

const router = express.Router();

router.get('/', listEnterprises);
router.get('/mine', authMiddleware, requireRoles(['vendeur', 'admin']), getMyEnterprises);
router.get('/:enterpriseId', optionalAuthMiddleware, getEnterpriseById);
router.post('/', authMiddleware, requireRoles(['vendeur', 'admin']), createEnterprise);

module.exports = router;
