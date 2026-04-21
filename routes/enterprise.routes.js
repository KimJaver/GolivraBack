const express = require('express');
const { listEnterprises, createEnterprise } = require('../controllers/enterprise.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

const router = express.Router();

router.get('/', listEnterprises);
router.post('/', authMiddleware, requireRoles(['vendeur', 'admin']), createEnterprise);

module.exports = router;
