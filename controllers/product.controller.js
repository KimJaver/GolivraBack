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
  const stock = p.est_disponible ? (p.stock ?? 999) : 0;
  return {
    id: p.id,
    entreprise_id: enterpriseId,
    nom: p.nom,
    description: p.description,
    prix: p.prix,
    stock: typeof p.stock === 'number' ? p.stock : stock,
    est_disponible: p.est_disponible !== false,
    image_url: p.image_url ?? null,
    kind: 'plat',
    options: p.options ?? null,
  };
}

function mapArticleToProduct(a, enterpriseId) {
  let stock = 999;
  if (a.stock !== null && a.stock !== undefined) stock = Math.max(0, Number(a.stock));
  if (!a.est_disponible) stock = 0;
  return {
    id: a.id,
    entreprise_id: enterpriseId,
    nom: a.nom,
    description: a.description,
    prix: a.prix,
    stock,
    est_disponible: a.est_disponible !== false,
    image_url: a.image_url ?? null,
    kind: 'article',
    options: a.options ?? null,
    reference: a.reference ?? null,
  };
}

function parseImageUrl(imageUrl) {
  return typeof imageUrl === 'string' && imageUrl.trim().startsWith('http') ? imageUrl.trim() : null;
}

async function findProductInEstablishment(db, kind, enterpriseId, productId) {
  if (kind === 'restaurant') {
    const { data, error } = await db
      .from('plats')
      .select('*')
      .eq('id', productId)
      .eq('restaurant_id', enterpriseId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  const { data, error } = await db
    .from('articles')
    .select('*')
    .eq('id', productId)
    .eq('boutique_id', enterpriseId)
    .maybeSingle();
  if (error) throw error;
  return data;
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
    const { nom, description, prix, stock, imageUrl } = req.body;
    requireFields(req.body, ['nom', 'prix']);
    const imgUrl = parseImageUrl(imageUrl);

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
          image_url: imgUrl,
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
        image_url: imgUrl,
      })
      .select('*')
      .single();
    if (error) throw error;
    return res.status(201).json(mapArticleToProduct(data, enterpriseId));
  } catch (error) {
    return next(error);
  }
}

async function updateProduct(req, res, next) {
  try {
    const { enterpriseId, productId } = req.params;
    const { nom, description, prix, stock, imageUrl, estDisponible } = req.body;

    const db = getDb();
    const resolved = await resolveEstablishment(db, enterpriseId);
    if (!resolved) throw createHttpError(404, 'Établissement introuvable');

    const { kind, row } = resolved;
    if (!canManageEstablishment(req, row)) throw createHttpError(403, 'Action non autorisée pour cet établissement');

    const existing = await findProductInEstablishment(db, kind, enterpriseId, productId);
    if (!existing) throw createHttpError(404, 'Produit introuvable');

    if (kind === 'restaurant') {
      if (req.auth.role !== 'admin' && req.auth.role !== 'restaurateur') {
        throw createHttpError(403, 'Seul un restaurateur peut modifier des plats.');
      }
      const patch = {};
      if (nom !== undefined) patch.nom = String(nom).trim();
      if (description !== undefined) patch.description = description || null;
      if (prix !== undefined) patch.prix = Number(prix);
      if (imageUrl !== undefined) patch.image_url = parseImageUrl(imageUrl);
      if (estDisponible !== undefined) patch.est_disponible = Boolean(estDisponible);

      const { data, error } = await db.from('plats').update(patch).eq('id', productId).select('*').single();
      if (error) throw error;
      return res.json(mapPlatToProduct(data, enterpriseId));
    }

    if (req.auth.role !== 'admin' && req.auth.role !== 'commercant') {
      throw createHttpError(403, 'Seul un commerçant peut modifier des articles.');
    }
    const patch = {};
    if (nom !== undefined) patch.nom = String(nom).trim();
    if (description !== undefined) patch.description = description || null;
    if (prix !== undefined) patch.prix = Number(prix);
    if (imageUrl !== undefined) patch.image_url = parseImageUrl(imageUrl);
    if (estDisponible !== undefined) patch.est_disponible = Boolean(estDisponible);
    if (stock !== undefined) {
      patch.stock = stock === null ? null : Math.max(0, Math.floor(Number(stock)));
    }

    const { data, error } = await db.from('articles').update(patch).eq('id', productId).select('*').single();
    if (error) throw error;
    return res.json(mapArticleToProduct(data, enterpriseId));
  } catch (error) {
    return next(error);
  }
}

async function deleteProduct(req, res, next) {
  try {
    const { enterpriseId, productId } = req.params;
    const db = getDb();
    const resolved = await resolveEstablishment(db, enterpriseId);
    if (!resolved) throw createHttpError(404, 'Établissement introuvable');

    const { kind, row } = resolved;
    if (!canManageEstablishment(req, row)) throw createHttpError(403, 'Action non autorisée pour cet établissement');

    const existing = await findProductInEstablishment(db, kind, enterpriseId, productId);
    if (!existing) throw createHttpError(404, 'Produit introuvable');

    const table = kind === 'restaurant' ? 'plats' : 'articles';
    const { error } = await db.from(table).delete().eq('id', productId);
    if (error) throw error;
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};
