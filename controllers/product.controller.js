const { getDb } = require('../config/db');
const { createHttpError, requireFields } = require('../utils/http');

async function listProducts(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();

    const { data, error } = await db.from('produits').select('*').eq('entreprise_id', enterpriseId).order('nom');
    if (error) throw error;
    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

async function createProduct(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const { nom, description, prix, stock, imageUrl } = req.body;
    requireFields(req.body, ['nom', 'prix', 'stock']);

    const db = getDb();
    const { data: enterprise, error: enterpriseError } = await db
      .from('entreprises')
      .select('id, proprietaire_id')
      .eq('id', enterpriseId)
      .single();
    if (enterpriseError || !enterprise) throw createHttpError(404, 'Enterprise not found');
    if (enterprise.proprietaire_id !== req.auth.userId) throw createHttpError(403, 'Not allowed for this enterprise');

    const { data, error } = await db
      .from('produits')
      .insert({
        entreprise_id: enterpriseId,
        nom,
        description: description || null,
        prix,
        stock,
        image_url: imageUrl || null,
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
  listProducts,
  createProduct,
};
