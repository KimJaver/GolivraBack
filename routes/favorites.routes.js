const express = require('express');
const {
  listMine,
  add,
  remove,
  toggle,
  sync,
  listMineProducts,
  toggleProduct,
  removeProduct,
} = require('../controllers/favorites.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

const router = express.Router();
const clientOnly = [authMiddleware, requireRoles(['client', 'admin'])];

router.get('/', ...clientOnly, listMine);
router.post('/', ...clientOnly, add);
router.post('/toggle', ...clientOnly, toggle);
router.post('/sync', ...clientOnly, sync);
router.delete('/:enterpriseId', ...clientOnly, remove);

// Favoris PRODUITS (plats + articles). Endpoints scopes sous /products
// pour ne pas interferer avec les routes entreprises ci-dessus.
router.get('/products', ...clientOnly, listMineProducts);
router.post('/products/toggle', ...clientOnly, toggleProduct);
router.delete('/products/:productId', ...clientOnly, removeProduct);

module.exports = router;
