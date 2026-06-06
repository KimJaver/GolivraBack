const express = require('express');
const router = express.Router();
const controller = require('../controllers/usage-tracking.controller');
const { authMiddleware } = require('../middlewares/auth.middleware');

/**
 * @api {post} /track/interaction Enregistrer une interaction utilisateur
 * @apiGroup Tracking
 */
router.post('/interaction', authMiddleware, controller.trackInteraction);

module.exports = router;
