/**
 * Admin : gestion des campagnes marketing et de leurs villes associées.
 */

const { createHttpError } = require('../utils/http');

function mapCampagne(row) {
  return {
    id: row.id,
    nom: row.nom,
    description: row.description || null,
    type: row.type,
    image_url: row.image_url || null,
    date_debut: row.date_debut || null,
    date_fin: row.date_fin || null,
    est_actif: row.est_actif,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Liste toutes les campagnes avec leurs villes associées. */
async function listCampagnes(db) {
  const { data, error } = await db
    .from('marketing_campaigns')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(mapCampagne);
}

/** Récupère une campagne avec ses villes. */
async function getCampagne(db, campagneId) {
  const { data, error } = await db
    .from('marketing_campaigns')
    .select('*')
    .eq('id', campagneId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw createHttpError(404, 'Campagne introuvable.');
  return mapCampagne(data);
}

/** Crée une campagne. */
async function createCampagne(db, body) {
  const nom = String(body.nom || '').trim();
  if (!nom) throw createHttpError(400, 'Le nom de la campagne est requis.');

  const payload = {
    nom,
    description: body.description || null,
    type: body.type || 'standard',
    image_url: body.image_url || null,
    date_debut: body.date_debut || null,
    date_fin: body.date_fin || null,
    est_actif: body.est_actif !== false,
  };

  const { data, error } = await db
    .from('marketing_campaigns')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return mapCampagne(data);
}

/** Met à jour une campagne. */
async function updateCampagne(db, campagneId, body) {
  const patch = {};
  if (body.nom !== undefined) patch.nom = String(body.nom).trim();
  if (body.description !== undefined) patch.description = body.description || null;
  if (body.type !== undefined) patch.type = body.type;
  if (body.image_url !== undefined) patch.image_url = body.image_url || null;
  if (body.date_debut !== undefined) patch.date_debut = body.date_debut || null;
  if (body.date_fin !== undefined) patch.date_fin = body.date_fin || null;
  if (body.est_actif !== undefined) patch.est_actif = body.est_actif;
  patch.updated_at = new Date().toISOString();

  if (Object.keys(patch).length <= 1) throw createHttpError(400, 'Aucun champ à mettre à jour.');

  const { data, error } = await db
    .from('marketing_campaigns')
    .update(patch)
    .eq('id', campagneId)
    .select('*')
    .single();
  if (error) {
    if (error.code === 'PGRST116') throw createHttpError(404, 'Campagne introuvable.');
    throw error;
  }
  return mapCampagne(data);
}

/** Supprime une campagne. */
async function deleteCampagne(db, campagneId) {
  const { error } = await db.from('marketing_campaigns').delete().eq('id', campagneId);
  if (error) {
    if (error.code === 'PGRST116') throw createHttpError(404, 'Campagne introuvable.');
    throw error;
  }
  return { message: 'Campagne supprimée.' };
}

// ── VILLES LIÉES À UNE CAMPAGNE ─────────────────────────────────────────────

/** Récupère la liste des IDs de villes associées à une campagne. */
async function getCampagneVilleIds(db, campagneId) {
  const { data, error } = await db
    .from('campagne_villes')
    .select('ville_id')
    .eq('campagne_id', campagneId);
  if (error) throw error;
  return (data || []).map(r => r.ville_id);
}

/** Remplace les villes associées à une campagne (sync total). */
async function setCampagneVilles(db, campagneId, villeIds) {
  const ids = Array.isArray(villeIds) ? villeIds.filter(Boolean) : [];
  if (!Array.isArray(ids)) throw createHttpError(400, 'ville_ids doit être un tableau.');

  // Supprime toutes les associations existantes
  const { error: delErr } = await db
    .from('campagne_villes')
    .delete()
    .eq('campagne_id', campagneId);
  if (delErr) throw delErr;

  if (ids.length === 0) return [];

  // Insère les nouvelles associations
  const rows = ids.map(ville_id => ({ campagne_id: campagneId, ville_id }));
  const { data, error: insErr } = await db
    .from('campagne_villes')
    .insert(rows)
    .select();
  if (insErr) throw insErr;
  return (data || []).map(r => r.ville_id);
}

/** Récupère les détails des villes associées à une campagne. */
async function getCampagneVillesDetail(db, campagneId) {
  const { data, error } = await db
    .from('campagne_villes')
    .select(`
      ville_id,
      villes!inner(id, nom, sort_order, pays_id)
    `)
    .eq('campagne_id', campagneId);
  if (error) throw error;
  return (data || []).map(r => ({
    id: r.ville_id,
    nom: r.villes.nom,
    pays_id: r.villes.pays_id,
    sort_order: r.villes.sort_order,
  }));
}

module.exports = {
  listCampagnes,
  getCampagne,
  createCampagne,
  updateCampagne,
  deleteCampagne,
  getCampagneVilleIds,
  setCampagneVilles,
  getCampagneVillesDetail,
};
