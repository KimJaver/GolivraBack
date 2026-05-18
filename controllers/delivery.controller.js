const { getDb } = require('../config/db');
const { createHttpError, requireFields } = require('../utils/http');

async function getLivreurIdForUser(db, userId) {
  const { data: liv, error } = await db.from('livreurs').select('id').eq('utilisateur_id', userId).maybeSingle();
  if (error) throw error;
  if (!liv) throw createHttpError(404, 'Profil livreur introuvable');
  return liv.id;
}

async function getDeliveryStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const db = getDb();

    const { data: order, error: orderError } = await db
      .from('commandes')
      .select('id, statut, created_at, client_id')
      .eq('id', orderId)
      .single();
    if (orderError || !order) throw createHttpError(404, 'Commande introuvable');

    const role = req.auth.role;
    if (role === 'admin') {
      /* ok */
    } else if (role === 'client' && order.client_id !== req.auth.userId) {
      throw createHttpError(403, 'Accès à cette commande non autorisé');
    } else if (role === 'restaurateur' || role === 'commercant') {
      const owned = await findVendorSousCommandeIdsForOrder(db, req.auth.userId, orderId);
      if (owned.length === 0) throw createHttpError(403, 'Accès à cette commande non autorisé');
    } else if (role === 'livreur') {
      const livreurId = await getLivreurIdForUser(db, req.auth.userId);
      const { data: scs } = await db.from('sous_commandes').select('id').eq('commande_id', orderId);
      const ids = (scs || []).map((s) => s.id);
      const { data: livs } = await db.from('livraisons').select('id').in('sous_commande_id', ids).eq('livreur_id', livreurId);
      if (!livs || livs.length === 0) throw createHttpError(403, 'Accès à cette commande non autorisé');
    }

    const { data: scs } = await db.from('sous_commandes').select('id').eq('commande_id', orderId);
    const scIds = (scs || []).map((s) => s.id);
    const { data: deliveries } = await db.from('livraisons').select('*').in('sous_commande_id', scIds);

    const delivery = deliveries && deliveries[0] ? deliveries[0] : null;

    return res.json({
      orderId: order.id,
      orderStatus: order.statut,
      delivery,
      deliveries: deliveries || [],
      createdAt: order.created_at,
    });
  } catch (error) {
    return next(error);
  }
}

async function findVendorSousCommandeIdsForOrder(db, userId, commandeId) {
  const { data: scs, error } = await db
    .from('sous_commandes')
    .select('id, restaurant_id, boutique_id')
    .eq('commande_id', commandeId);
  if (error) throw error;

  const owned = [];
  for (const sc of scs || []) {
    if (sc.restaurant_id) {
      const { data: r } = await db.from('restaurants').select('proprietaire_id').eq('id', sc.restaurant_id).maybeSingle();
      if (r?.proprietaire_id === userId) owned.push(sc.id);
    }
    if (sc.boutique_id) {
      const { data: b } = await db.from('boutiques').select('proprietaire_id').eq('id', sc.boutique_id).maybeSingle();
      if (b?.proprietaire_id === userId) owned.push(sc.id);
    }
  }
  return owned;
}

async function updateCourierAvailability(req, res, next) {
  try {
    requireFields(req.body, ['disponible']);
    const db = getDb();
    const courierId = await getLivreurIdForUser(db, req.auth.userId);

    const { data, error } = await db
      .from('livreurs')
      .update({ est_disponible: Boolean(req.body.disponible) })
      .eq('id', courierId)
      .select('*')
      .single();
    if (error) throw error;

    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

async function updateCourierPosition(req, res, next) {
  try {
    requireFields(req.body, ['latitude', 'longitude']);
    const db = getDb();
    const courierId = await getLivreurIdForUser(db, req.auth.userId);

    await db
      .from('livreurs')
      .update({
        latitude_actuelle: req.body.latitude,
        longitude_actuelle: req.body.longitude,
        derniere_position_at: new Date().toISOString(),
      })
      .eq('id', courierId);

    const { data, error } = await db
      .from('positions_livreurs')
      .insert({
        livreur_id: courierId,
        latitude: req.body.latitude,
        longitude: req.body.longitude,
      })
      .select('*')
      .single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (error) {
    return next(error);
  }
}

async function acceptDelivery(req, res, next) {
  try {
    const { deliveryId } = req.params;
    const db = getDb();
    const courierId = await getLivreurIdForUser(db, req.auth.userId);

    const { data, error } = await db
      .from('livraisons')
      .update({
        livreur_id: courierId,
        statut: 'en_route',
        attribuee_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .select('*')
      .single();
    if (error || !data) throw createHttpError(404, 'Livraison introuvable');

    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

async function completeDelivery(req, res, next) {
  try {
    const { deliveryId } = req.params;
    const db = getDb();
    const courierId = await getLivreurIdForUser(db, req.auth.userId);

    const { data, error } = await db
      .from('livraisons')
      .update({
        statut: 'livree',
        livree_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .eq('livreur_id', courierId)
      .select('*')
      .single();
    if (error || !data) throw createHttpError(404, 'Livraison introuvable pour ce livreur');

    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getDeliveryStatus,
  updateCourierAvailability,
  updateCourierPosition,
  acceptDelivery,
  completeDelivery,
};
