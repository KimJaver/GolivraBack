const { recordInteraction } = require('../services/personalization.service');
const { requireFields } = require('../utils/http');

/**
 * Enregistre une interaction utilisateur pour l'algorithme de personnalisation.
 */
async function trackInteraction(req, res, next) {
  try {
    const { type, targetId, targetType, categoryId, metadata } = req.body;
    requireFields(req.body, ['type']);

    // Si l'utilisateur n'est pas connecté, on ne stocke rien (anonyme)
    if (!req.auth || !req.auth.userId) {
        return res.status(204).end();
    }

    await recordInteraction(req.auth.userId, {
      type,
      targetId,
      targetType,
      categoryId,
      metadata
    });

    return res.status(204).end();
  } catch (error) {
    // On ne bloque pas l'utilisateur pour une erreur de tracking
    console.error('[Tracking Error]', error);
    return res.status(204).end();
  }
}

module.exports = {
  trackInteraction
};
