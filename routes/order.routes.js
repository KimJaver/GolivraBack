const express = require('express');
const {
  createOrder,
  getOrders,
  getOrderDetails,
  updateOrderStatus,
} = require('../controllers/order.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

const router = express.Router();

router.get('/', authMiddleware, getOrders);
router.get('/:orderId', authMiddleware, getOrderDetails);
router.post('/', authMiddleware, requireRoles(['client', 'admin']), createOrder);
router.patch('/:orderId/status', authMiddleware, requireRoles(['vendeur', 'admin']), updateOrderStatus);

module.exports = router;
