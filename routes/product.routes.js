const express = require('express');
const { listProducts, createProduct } = require('../controllers/product.controller');
const { authMiddleware, optionalAuthMiddleware } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

const router = express.Router();

router.get('/enterprise/:enterpriseId', optionalAuthMiddleware, listProducts);
router.post('/enterprise/:enterpriseId', authMiddleware, requireRoles(['restaurateur', 'commercant', 'admin']), createProduct);

module.exports = router;
