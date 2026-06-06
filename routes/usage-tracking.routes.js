const express = require('express');
const router = express.Router();
const controller = require('../controllers/usage-tracking.controller');
const { requireAuth } = require('../middlewares/auth.middleware');

/**
 * @api {post} /track/interaction Enregistrer une interaction utilisateur
 * @apiGroup Tracking
 */
router.post('/interaction', requireAuth, controller.trackInteraction);

module.exports = router;
