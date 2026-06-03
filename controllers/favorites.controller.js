const { getDb } = require('../config/db');
const { requireFields } = require('../utils/http');
const {
  listFavorites,
  addFavorite,
  removeFavorite,
  toggleFavorite,
  syncFavorites,
  listFavoriteProducts,
  toggleFavoriteProduct,
  removeFavoriteProduct,
} = require('../services/favorites.service');

async function listMine(req, res, next) {
  try {
    const db = getDb();
    const items = await listFavorites(db, req.auth.userId);
    return res.json({ items, enterprise_ids: items.map((i) => i.enterprise_id) });
  } catch (error) {
    return next(error);
  }
}

async function add(req, res, next) {
  try {
    const { enterpriseId, enterpriseType } = req.body;
    requireFields(req.body, ['enterpriseId']);
    const db = getDb();
    const result = await addFavorite(db, req.auth.userId, enterpriseId, enterpriseType);
    return res.status(201).json(result);
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();
    const result = await removeFavorite(db, req.auth.userId, enterpriseId);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}

async function toggle(req, res, next) {
  try {
    const { enterpriseId, enterpriseType } = req.body;
    requireFields(req.body, ['enterpriseId']);
    const db = getDb();
    const result = await toggleFavorite(db, req.auth.userId, enterpriseId, enterpriseType);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}

async function sync(req, res, next) {
  try {
    const { enterpriseIds } = req.body;
    const db = getDb();
    const items = await syncFavorites(db, req.auth.userId, enterpriseIds);
    return res.json({ items, enterprise_ids: items.map((i) => i.enterprise_id) });
  } catch (error) {
    return next(error);
  }
}

/* ============================================================ */
/* PRODUITS (plats + articles)                                  */
/* ============================================================ */

async function listMineProducts(req, res, next) {
  try {
    const db = getDb();
    const items = await listFavoriteProducts(db, req.auth.userId);
    return res.json({ items });
  } catch (error) {
    return next(error);
  }
}

async function toggleProduct(req, res, next) {
  try {
    const { produitId, produitKind } = req.body;
    requireFields(req.body, ['produitId', 'produitKind']);
    const db = getDb();
    const result = await toggleFavoriteProduct(db, req.auth.userId, produitId, produitKind);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}

async function removeProduct(req, res, next) {
  try {
    const { productId } = req.params;
    const { produitKind } = req.query;
    const kind = String(produitKind || '');
    const db = getDb();
    const result = await removeFavoriteProduct(db, req.auth.userId, productId, kind);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listMine,
  add,
  remove,
  toggle,
  sync,
  listMineProducts,
  toggleProduct,
  removeProduct,
};
