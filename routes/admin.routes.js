const express = require('express');
const { createCourier } = require('../controllers/admin.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');
const { requireRoles } = require('../middlewares/role.middleware');

const router = express.Router();

router.post('/couriers', authMiddleware, requireRoles(['admin']), createCourier);

module.exports = router;
