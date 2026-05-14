const { getDb } = require('../config/db');
const { requireFields, createHttpError } = require('../utils/http');

const COMMERCE_TYPES = new Set(['restaurant', 'boutique']);

const MODERATION = {
  EN_ATTENTE: 'en_attente',
  ACTIVE: 'active',
  SUSPENDU: 'suspendu',
};

function initialModerationStatus() {
  const v = (process.env.ENTERPRISE_AUTO_APPROVE || '').trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes') {
    return MODERATION.ACTIVE;
  }
  return MODERATION.EN_ATTENTE;
}

function canBypassModerationCheck(req, enterprise) {
  if (!req.auth || !enterprise) return false;
  if (req.auth.role === 'admin') return true;
  if (enterprise.proprietaire_id && enterprise.proprietaire_id === req.auth.userId) return true;
  return false;
}

function isEnterprisePubliclyVisible(enterprise) {
  return (
    enterprise &&
    enterprise.statut_moderation === MODERATION.ACTIVE &&
    enterprise.ouvert === true
  );
}

async function listEnterprises(req, res, next) {
  try {
    const { type } = req.query;
    const db = getDb();
    let query = db
      .from('entreprises')
      .select('*')
      .eq('ouvert', true)
      .eq('statut_moderation', MODERATION.ACTIVE)
      .order('nom', { ascending: true });

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

async function getMyEnterprises(req, res, next) {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('entreprises')
      .select('*')
      .eq('proprietaire_id', req.auth.userId)
      .order('nom', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return next(error);
  }
}

async function createEnterprise(req, res, next) {
  try {
    const { nom, type, description, telephone, adresse, latitude, longitude, imageUrl } = req.body;
    requireFields(req.body, ['nom', 'type', 'telephone', 'adresse']);

    if (!COMMERCE_TYPES.has(type)) {
      throw createHttpError(400, 'Type de commerce invalide (restaurant ou boutique).');
    }

    const statutModeration = initialModerationStatus();

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
        image_url: imageUrl || null,
        latitude: latitude || null,
        longitude: longitude || null,
        statut_moderation: statutModeration,
      })
      .select('*')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return next(error);
  }
}

async function getEnterpriseById(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();
    const { data, error } = await db.from('entreprises').select('*').eq('id', enterpriseId).maybeSingle();
    if (error) throw error;
    if (!data) throw createHttpError(404, 'Commerce introuvable ou fermé.');

    if (!isEnterprisePubliclyVisible(data) && !canBypassModerationCheck(req, data)) {
      throw createHttpError(404, 'Commerce introuvable ou fermé.');
    }

    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listEnterprises,
  getEnterpriseById,
  createEnterprise,
  getMyEnterprises,
};
