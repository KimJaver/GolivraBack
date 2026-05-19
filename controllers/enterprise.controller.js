const { getDb } = require('../config/db');
const { requireFields, createHttpError } = require('../utils/http');
const { resolveStoredImage, logoFieldsFromBody } = require('../utils/images');

const COMMERCE_TYPES = new Set(['restaurant', 'boutique']);

const MODERATION = {
  EN_ATTENTE: 'en_attente',
  ACTIVE: 'active',
  SUSPENDUE: 'suspendue',
};

function initialModerationStatus() {
  const v = (process.env.ENTERPRISE_AUTO_APPROVE || '').trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') {
    return MODERATION.ACTIVE;
  }
  return MODERATION.EN_ATTENTE;
}

function mapRestaurant(r, categorieNom) {
  return {
    id: r.id,
    nom: r.nom,
    type: 'restaurant',
    description: r.description,
    telephone: r.telephone,
    adresse: r.adresse_ligne1,
    latitude: r.latitude,
    longitude: r.longitude,
    statut_moderation: r.statut,
    ouvert: r.est_ouvert,
    proprietaire_id: r.proprietaire_id,
    categorie_id: r.categorie_id,
    categorie_nom: categorieNom ?? null,
    image_url: r.logo_url ?? null,
    delai_preparation_min: r.delai_preparation_min ?? 20,
    livraison_propre: r.livraison_propre === true,
    frais_livraison: Number(r.frais_livraison ?? 500),
  };
}

function mapBoutique(b, categorieNom) {
  return {
    id: b.id,
    nom: b.nom,
    type: 'boutique',
    description: b.description,
    telephone: b.telephone,
    adresse: b.adresse_ligne1,
    latitude: b.latitude,
    longitude: b.longitude,
    statut_moderation: b.statut,
    ouvert: b.est_ouvert,
    proprietaire_id: b.proprietaire_id,
    categorie_id: b.categorie_id,
    categorie_nom: categorieNom ?? null,
    image_url: b.logo_url ?? null,
    delai_livraison_min: b.delai_livraison_min ?? 30,
    livraison_propre: b.livraison_propre === true,
    frais_livraison: Number(b.frais_livraison ?? 500),
  };
}

async function loadCategoryName(db, type, categorieId) {
  if (!categorieId) return null;
  const table = type === 'restaurant' ? 'categories_restaurants' : 'categories_boutiques';
  const { data } = await db.from(table).select('nom').eq('id', categorieId).maybeSingle();
  return data?.nom ?? null;
}

function canBypassModerationCheck(req, row) {
  if (!req.auth || !row) return false;
  if (req.auth.role === 'admin') return true;
  if (row.proprietaire_id && row.proprietaire_id === req.auth.userId) return true;
  return false;
}

function isPubliclyVisible(row) {
  return row && row.statut === MODERATION.ACTIVE && row.est_ouvert === true;
}

async function listEnterprises(req, res, next) {
  try {
    const { type } = req.query;
    const db = getDb();
    const out = [];

    if (!type || type === 'restaurant') {
      let q = db
        .from('restaurants')
        .select('*')
        .eq('est_ouvert', true)
        .eq('statut', MODERATION.ACTIVE)
        .order('nom', { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      (data || []).forEach((r) => out.push(mapRestaurant(r)));
    }

    if (!type || type === 'boutique') {
      let q = db
        .from('boutiques')
        .select('*')
        .eq('est_ouvert', true)
        .eq('statut', MODERATION.ACTIVE)
        .order('nom', { ascending: true });
      const { data, error } = await q;
      if (error) throw error;
      (data || []).forEach((b) => out.push(mapBoutique(b)));
    }

    out.sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || '')));
    return res.json(out);
  } catch (error) {
    return next(error);
  }
}

async function listCategories(req, res, next) {
  try {
    const { type } = req.params;
    if (!COMMERCE_TYPES.has(type)) {
      throw createHttpError(400, 'Type invalide (restaurant ou boutique).');
    }
    const db = getDb();
    const table = type === 'restaurant' ? 'categories_restaurants' : 'categories_boutiques';
    const { data, error } = await db
      .from(table)
      .select('id, nom, description, ordre')
      .eq('est_active', true)
      .order('ordre', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return next(error);
  }
}

async function resolveCategoryId(db, type, categorieId) {
  if (!categorieId) {
    throw createHttpError(400, 'La catégorie est obligatoire.');
  }
  const table = type === 'restaurant' ? 'categories_restaurants' : 'categories_boutiques';
  const { data, error } = await db.from(table).select('id').eq('id', categorieId).eq('est_active', true).maybeSingle();
  if (error) throw error;
  if (!data) throw createHttpError(400, 'Catégorie invalide ou inactive.');
  return data.id;
}

async function getMyEnterprises(req, res, next) {
  try {
    const db = getDb();
    const [rRes, bRes] = await Promise.all([
      db.from('restaurants').select('*').eq('proprietaire_id', req.auth.userId).order('nom', { ascending: true }),
      db.from('boutiques').select('*').eq('proprietaire_id', req.auth.userId).order('nom', { ascending: true }),
    ]);
    if (rRes.error) throw rRes.error;
    if (bRes.error) throw bRes.error;
    const out = [];
    for (const r of rRes.data || []) {
      const cat = await loadCategoryName(db, 'restaurant', r.categorie_id);
      out.push(mapRestaurant(r, cat));
    }
    for (const b of bRes.data || []) {
      const cat = await loadCategoryName(db, 'boutique', b.categorie_id);
      out.push(mapBoutique(b, cat));
    }
    out.sort((a, b) => String(a.nom || '').localeCompare(String(b.nom || '')));
    return res.json(out);
  } catch (error) {
    return next(error);
  }
}

async function createEnterprise(req, res, next) {
  try {
    const { nom, type, description, telephone, adresse, latitude, longitude, categorieId } = req.body;
    requireFields(req.body, ['nom', 'type', 'telephone', 'adresse', 'categorieId']);

    if (!COMMERCE_TYPES.has(type)) {
      throw createHttpError(400, 'Type de commerce invalide (restaurant ou boutique).');
    }

    if (type === 'restaurant' && req.auth.role !== 'restaurateur' && req.auth.role !== 'admin') {
      throw createHttpError(403, 'Seuls les comptes restaurateur peuvent créer un restaurant.');
    }
    if (type === 'boutique' && req.auth.role !== 'commercant' && req.auth.role !== 'admin') {
      throw createHttpError(403, 'Seuls les comptes commerçant peuvent créer une boutique.');
    }

    const statut = initialModerationStatus();

    const db = getDb();
    const resolvedCategoryId = await resolveCategoryId(db, type, categorieId);
    const logoFields = logoFieldsFromBody(req.body);

    const base = {
      proprietaire_id: req.auth.userId,
      categorie_id: resolvedCategoryId,
      nom,
      description: description || null,
      telephone,
      adresse_ligne1: adresse,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      statut,
      est_ouvert: statut === MODERATION.ACTIVE,
      ...logoFields,
    };

    if (type === 'restaurant') {
      const { data, error } = await db.from('restaurants').insert(base).select('*').single();
      if (error) throw error;
      return res.status(201).json(mapRestaurant(data));
    }

    const { data, error } = await db.from('boutiques').insert(base).select('*').single();
    if (error) throw error;
    return res.status(201).json(mapBoutique(data));
  } catch (error) {
    return next(error);
  }
}

async function getEnterpriseById(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();

    const { data: resto, error: rErr } = await db.from('restaurants').select('*').eq('id', enterpriseId).maybeSingle();
    if (rErr) throw rErr;
    if (resto) {
      const mapped = mapRestaurant(resto);
      if (isPubliclyVisible(resto) || canBypassModerationCheck(req, resto)) {
        return res.json(mapped);
      }
      throw createHttpError(404, 'Commerce introuvable ou fermé.');
    }

    const { data: bout, error: bErr } = await db.from('boutiques').select('*').eq('id', enterpriseId).maybeSingle();
    if (bErr) throw bErr;
    if (bout) {
      const mapped = mapBoutique(bout);
      if (isPubliclyVisible(bout) || canBypassModerationCheck(req, bout)) {
        return res.json(mapped);
      }
      throw createHttpError(404, 'Commerce introuvable ou fermé.');
    }

    throw createHttpError(404, 'Commerce introuvable ou fermé.');
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listEnterprises,
  listCategories,
  getEnterpriseById,
  createEnterprise,
  getMyEnterprises,
};
