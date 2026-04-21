const { getDb } = require('../config/db');
const { createHttpError, requireFields } = require('../utils/http');

async function getCourierIdByPhone(db, telephone) {
  const { data: courier, error } = await db.from('livreurs').select('id').eq('telephone', telephone).single();
  if (error || !courier) throw createHttpError(404, 'Profil livreur introuvable');
  return courier.id;
}

async function getDeliveryStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const db = getDb();

    const { data: order, error: orderError } = await db
      .from('commandes')
      .select('id, statut, cree_le, utilisateur_id, entreprise_id')
      .eq('id', orderId)
      .single();
    if (orderError || !order) throw createHttpError(404, 'Commande introuvable');

    const role = req.auth.role;
    if (role === 'admin') {
      // full access
    } else if (role === 'client' && order.utilisateur_id !== req.auth.userId) {
      throw createHttpError(403, 'Accès à cette commande non autorisé');
    } else if (role === 'vendeur') {
      const { data: owned } = await db
        .from('entreprises')
        .select('id')
        .eq('id', order.entreprise_id)
        .eq('proprietaire_id', req.auth.userId)
        .maybeSingle();
      if (!owned) throw createHttpError(403, 'Accès à cette commande non autorisé');
    } else if (role === 'livreur') {
      const { data: courier } = await db.from('livreurs').select('id').eq('telephone', req.auth.telephone).maybeSingle();
      if (!courier) throw createHttpError(403, 'Profil livreur introuvable');
      const { data: deliveryRow } = await db
        .from('livraisons')
        .select('id, livreur_id')
        .eq('commande_id', orderId)
        .maybeSingle();
      if (!deliveryRow || deliveryRow.livreur_id !== courier.id) {
        throw createHttpError(403, 'Accès à cette commande non autorisé');
      }
    }

    const { data: delivery } = await db
      .from('livraisons')
      .select('id, statut, assigne_le, livre_le, livreur_id')
      .eq('commande_id', orderId)
      .maybeSingle();

    return res.json({
      orderId: order.id,
      orderStatus: order.statut,
      delivery: delivery || null,
      createdAt: order.cree_le,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateCourierAvailability(req, res, next) {
  try {
    requireFields(req.body, ['disponible']);
    const db = getDb();
    const courierId = await getCourierIdByPhone(db, req.auth.telephone);

    const { data, error } = await db
      .from('livreurs')
      .update({ disponible: Boolean(req.body.disponible) })
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
    const courierId = await getCourierIdByPhone(db, req.auth.telephone);

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
    const courierId = await getCourierIdByPhone(db, req.auth.telephone);

    const { data, error } = await db
      .from('livraisons')
      .update({
        livreur_id: courierId,
        statut: 'en livraison',
        assigne_le: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .select('*')
      .single();
    if (error || !data) throw createHttpError(404, 'Livraison introuvable');

    await db.from('commandes').update({ statut: 'en livraison' }).eq('id', data.commande_id);
    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

async function completeDelivery(req, res, next) {
  try {
    const { deliveryId } = req.params;
    const db = getDb();
    const courierId = await getCourierIdByPhone(db, req.auth.telephone);

    const { data, error } = await db
      .from('livraisons')
      .update({
        statut: 'livree',
        livre_le: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .eq('livreur_id', courierId)
      .select('*')
      .single();
    if (error || !data) throw createHttpError(404, 'Livraison introuvable pour ce livreur');

    await db.from('commandes').update({ statut: 'livree' }).eq('id', data.commande_id);
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
