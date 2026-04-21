const { getDb } = require('../config/db');
const { requireFields } = require('../utils/http');

async function listEnterprises(req, res, next) {
  try {
    const { type } = req.query;
    const db = getDb();
    let query = db.from('entreprises').select('*').eq('ouvert', true).order('nom', { ascending: true });

    if (type) {
      query = query.eq('type', type);
    }

    const { data, error } = await query;
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

async function createEnterprise(req, res, next) {
  try {
    const { nom, type, description, telephone, adresse, latitude, longitude } = req.body;
    requireFields(req.body, ['nom', 'type', 'telephone', 'adresse']);

    const db = getDb();
    const { data, error } = await db
      .from('entreprises')
      .insert({
        proprietaire_id: req.auth.userId,
        nom,
        type,
        description: description || null,
        telephone,
        adresse,
        latitude: latitude || null,
        longitude: longitude || null,
      })
      .select('*')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listEnterprises,
  createEnterprise,
};
