const { getDb } = require('../config/db');
const { createHttpError, requireFields } = require('../utils/http');

const ACTIVE = 'active';

async function resolveEstablishment(db, enterpriseId) {
  const { data: r } = await db.from('restaurants').select('*').eq('id', enterpriseId).maybeSingle();
  if (r) return { kind: 'restaurant', row: r };
  const { data: b } = await db.from('boutiques').select('*').eq('id', enterpriseId).maybeSingle();
  if (b) return { kind: 'boutique', row: b };
  return null;
}

function canManageEstablishment(req, row) {
  if (!req.auth || !row) return false;
  if (req.auth.role === 'admin') return true;
  return row.proprietaire_id === req.auth.userId;
}

function mapPlatToProduct(p, enterpriseId) {
  const stock = p.est_disponible ? 999 : 0;
  return {
    id: p.id,
    entreprise_id: enterpriseId,
    nom: p.nom,
    description: p.description,
    prix: p.prix,
    stock,
    image_url: null,
    kind: 'plat',
  };
}

function mapArticleToProduct(a, enterpriseId) {
  let stock = 999;
  if (a.stock !== null && a.stock !== undefined) stock = Math.max(0, Number(a.stock));
  return {
    id: a.id,
    entreprise_id: enterpriseId,
    nom: a.nom,
    description: a.description,
    prix: a.prix,
    stock,
    image_url: null,
    kind: 'article',
  };
}

async function listProducts(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();

    const resolved = await resolveEstablishment(db, enterpriseId);
    if (!resolved) throw createHttpError(404, 'Établissement introuvable');

    const { kind, row } = resolved;
    const visible = row.statut === ACTIVE;
    if (!visible && !canManageEstablishment(req, row)) {
      throw createHttpError(404, 'Établissement introuvable');
    }

    if (kind === 'restaurant') {
      const { data, error } = await db
        .from('plats')
        .select('*')
        .eq('restaurant_id', enterpriseId)
        .order('nom');
      if (error) throw error;
      return res.json((data || []).map((p) => mapPlatToProduct(p, enterpriseId)));
    }

    const { data, error } = await db
      .from('articles')
      .select('*')
      .eq('boutique_id', enterpriseId)
      .order('nom');
    if (error) throw error;
    return res.json((data || []).map((a) => mapArticleToProduct(a, enterpriseId)));
  } catch (error) {
    return next(error);
  }
}

async function createProduct(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const { nom, description, prix, stock } = req.body;
    requireFields(req.body, ['nom', 'prix']);

    const db = getDb();
    const resolved = await resolveEstablishment(db, enterpriseId);
    if (!resolved) throw createHttpError(404, 'Établissement introuvable');

    const { kind, row } = resolved;
    if (!canManageEstablishment(req, row)) throw createHttpError(403, 'Action non autorisée pour cet établissement');

    if (kind === 'restaurant') {
      if (req.auth.role !== 'admin' && req.auth.role !== 'restaurateur') {
        throw createHttpError(403, 'Seul un restaurateur peut ajouter des plats.');
      }
      const prixNum = Number(prix);
      const { data, error } = await db
        .from('plats')
        .insert({
          restaurant_id: enterpriseId,
          nom,
          description: description || null,
          prix: prixNum,
          est_disponible: true,
        })
        .select('*')
        .single();
      if (error) throw error;
      return res.status(201).json(mapPlatToProduct(data, enterpriseId));
    }

    if (req.auth.role !== 'admin' && req.auth.role !== 'commercant') {
      throw createHttpError(403, 'Seul un commerçant peut ajouter des articles.');
    }
    const prixNum = Number(prix);
    const stockVal =
      stock === undefined || stock === null ? null : Math.max(0, Math.floor(Number(stock)));

    const { data, error } = await db
      .from('articles')
      .insert({
        boutique_id: enterpriseId,
        nom,
        description: description || null,
        prix: prixNum,
        stock: stockVal,
        est_disponible: true,
      })
      .select('*')
      .single();
    if (error) throw error;
    return res.status(201).json(mapArticleToProduct(data, enterpriseId));
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listProducts,
  createProduct,
};
