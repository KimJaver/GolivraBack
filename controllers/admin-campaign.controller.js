const { getDb } = require('../config/db');
const {
  listCampagnes,
  getCampagne,
  createCampagne,
  updateCampagne,
  deleteCampagne,
  getCampagneVilleIds,
  setCampagneVilles,
  getCampagneVillesDetail,
} = require('../services/admin-campaign.service');

async function getCampagnesList(req, res, next) {
  try {
    const db = getDb();
    const list = await listCampagnes(db);
    // Enrichir chaque campagne avec ses villes
    const enriched = await Promise.all(
      list.map(async (c) => {
        const villeIds = await getCampagneVilleIds(db, c.id);
        const villes = await getCampagneVillesDetail(db, c.id);
        return { ...c, ville_ids: villeIds, villes };
      }),
    );
    return res.json(enriched);
  } catch (e) { return next(e); }
}

async function getCampagneDetail(req, res, next) {
  try {
    const db = getDb();
    const campagne = await getCampagne(db, req.params.campagneId);
    const villeIds = await getCampagneVilleIds(db, campagne.id);
    const villes = await getCampagneVillesDetail(db, campagne.id);
    return res.json({ ...campagne, ville_ids: villeIds, villes });
  } catch (e) { return next(e); }
}

async function postCampagne(req, res, next) {
  try {
    const db = getDb();
    const campagne = await createCampagne(db, req.body);
    if (Array.isArray(req.body.ville_ids)) {
      await setCampagneVilles(db, campagne.id, req.body.ville_ids);
    }
    const villeIds = await getCampagneVilleIds(db, campagne.id);
    const villes = await getCampagneVillesDetail(db, campagne.id);
    return res.status(201).json({ ...campagne, ville_ids: villeIds, villes });
  } catch (e) { return next(e); }
}

async function patchCampagne(req, res, next) {
  try {
    const db = getDb();
    const campagne = await updateCampagne(db, req.params.campagneId, req.body);
    if (req.body.ville_ids !== undefined) {
      await setCampagneVilles(db, campagne.id, req.body.ville_ids);
    }
    const villeIds = await getCampagneVilleIds(db, campagne.id);
    const villes = await getCampagneVillesDetail(db, campagne.id);
    return res.json({ ...campagne, ville_ids: villeIds, villes });
  } catch (e) { return next(e); }
}

async function removeCampagne(req, res, next) {
  try {
    const db = getDb();
    return res.json(await deleteCampagne(db, req.params.campagneId));
  } catch (e) { return next(e); }
}

module.exports = {
  getCampagnesList,
  getCampagneDetail,
  postCampagne,
  patchCampagne,
  removeCampagne,
};
