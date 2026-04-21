const { getDb } = require('../config/db');
const { requireFields } = require('../utils/http');

async function createCourier(req, res, next) {
  try {
    const { nom, telephone, typeVehicule, entrepriseLivraisonId } = req.body;
    requireFields(req.body, ['nom', 'telephone', 'typeVehicule']);

    const db = getDb();
    const { data, error } = await db
      .from('livreurs')
      .insert({
        nom,
        telephone,
        type_vehicule: typeVehicule,
        entreprise_id: entrepriseLivraisonId || null,
        disponible: true,
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
  createCourier,
};
