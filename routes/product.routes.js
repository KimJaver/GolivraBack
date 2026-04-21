const express = require('express');
const { listProducts, createProduct } = require('../controllers/product.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

const router = express.Router();

router.get('/enterprise/:enterpriseId', listProducts);
router.post('/enterprise/:enterpriseId', authMiddleware, requireRoles(['vendeur', 'admin']), createProduct);

module.exports = router;
