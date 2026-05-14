const { getDb } = require('../config/db');
const { requireFields, createHttpError } = require('../utils/http');

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

/** Commerces en attente de validation (marketplace). */
async function listEnterprisesPending(req, res, next) {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('entreprises')
      .select('*')
      .eq('statut_moderation', 'en_attente')
      .order('nom', { ascending: true });
    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    return next(error);
  }
}

/** Rend le commerce visible sur GoLivra (marketplace + commandes). */
async function activateEnterprise(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();
    const { data, error } = await db
      .from('entreprises')
      .update({ statut_moderation: 'active' })
      .eq('id', enterpriseId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw createHttpError(404, 'Commerce introuvable.');
    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

/** Retire le commerce de la marketplace (sans supprimer le compte). */
async function suspendEnterprise(req, res, next) {
  try {
    const { enterpriseId } = req.params;
    const db = getDb();
    const { data, error } = await db
      .from('entreprises')
      .update({ statut_moderation: 'suspendu' })
      .eq('id', enterpriseId)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw createHttpError(404, 'Commerce introuvable.');
    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createCourier,
  listEnterprisesPending,
  activateEnterprise,
  suspendEnterprise,
};
