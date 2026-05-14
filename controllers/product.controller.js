const { getDb } = require('../config/db');
const { createHttpError, requireFields } = require('../utils/http');

const ACTIVE = 'active';

function canManageEnterprise(req, enterprise) {
  if (!req.auth || !enterprise) return false;
  if (req.auth.role === 'admin') return true;
  if (enterprise.proprietaire_id && enterprise.proprietaire_id === req.auth.userId) return true;
  return false;
}

async function listProducts(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();

    const { data: enterprise, error: entErr } = await db
      .from('entreprises')
      .select('id, proprietaire_id, statut_moderation')
      .eq('id', enterpriseId)
      .maybeSingle();
    if (entErr) throw entErr;
    if (!enterprise) throw createHttpError(404, 'Entreprise introuvable');

    const visible = enterprise.statut_moderation === ACTIVE;
    if (!visible && !canManageEnterprise(req, enterprise)) {
      throw createHttpError(404, 'Entreprise introuvable');
    }

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
    if (enterpriseError || !enterprise) throw createHttpError(404, 'Entreprise introuvable');
    if (enterprise.proprietaire_id !== req.auth.userId) throw createHttpError(403, 'Action non autorisée pour cette entreprise');

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
