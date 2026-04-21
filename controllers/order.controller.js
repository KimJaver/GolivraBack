const { getDb } = require('../config/db');
const { createHttpError, requireFields } = require('../utils/http');

const ALLOWED_STATUS = new Set([
  'commande creee',
  'en attente vendeur',
  'acceptee',
  'en preparation',
  'prete',
  'en livraison',
  'livree',
  'annulee',
  'probleme',
]);

async function createOrder(req, res, next) {
  try {
    const { entrepriseId, articles, adresseLivraison, latitude, longitude } = req.body;
    requireFields(req.body, ['entrepriseId', 'articles', 'adresseLivraison']);
    if (!Array.isArray(articles) || articles.length === 0) {
      throw createHttpError(400, 'Le champ articles doit être un tableau non vide');
    }

    const total = articles.reduce((sum, article) => {
      if (!article.itemId || !article.typeItem || !article.quantite || !article.prixUnitaire) {
        throw createHttpError(400, 'Chaque article doit inclure itemId, typeItem, quantite et prixUnitaire');
      }
      return sum + Number(article.quantite) * Number(article.prixUnitaire);
    }, 0);

    const db = getDb();
    const { data: order, error } = await db
      .from('commandes')
      .insert({
        utilisateur_id: req.auth.userId,
        entreprise_id: entrepriseId,
        statut: 'en attente vendeur',
        prix_total: total,
        adresse_livraison: adresseLivraison,
        latitude: latitude || null,
        longitude: longitude || null,
      })
      .select('*')
      .single();
    if (error) throw error;

    const orderItems = articles.map((article) => ({
      commande_id: order.id,
      item_id: article.itemId,
      type_item: article.typeItem,
      quantite: article.quantite,
      prix: article.prixUnitaire,
    }));

    const { error: itemsError } = await db.from('commande_articles').insert(orderItems);
    if (itemsError) throw itemsError;

    return res.status(201).json(order);
  } catch (error) {
    return next(error);
  }
}

async function getOrders(req, res, next) {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('commandes')
      .select('*')
      .eq('utilisateur_id', req.auth.userId)
      .order('cree_le', { ascending: false });
    if (error) throw error;

    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

async function getOrderDetails(req, res, next) {
  try {
    const db = getDb();
    const { orderId } = req.params;

    const { data: order, error } = await db
      .from('commandes')
      .select('*')
      .eq('id', orderId)
      .eq('utilisateur_id', req.auth.userId)
      .single();
    if (error || !order) throw createHttpError(404, 'Commande introuvable');

    const { data: articles, error: itemsError } = await db
      .from('commande_articles')
      .select('*')
      .eq('commande_id', orderId);
    if (itemsError) throw itemsError;

    return res.json({ ...order, articles });
  } catch (error) {
    return next(error);
  }
}

async function updateOrderStatus(req, res, next) {
  try {
    const { orderId } = req.params;
    const { statut } = req.body;
    requireFields(req.body, ['statut']);

    if (!ALLOWED_STATUS.has(statut)) {
      throw createHttpError(400, 'Statut de commande non pris en charge');
    }

    const db = getDb();

    if (req.auth.role === 'admin') {
      const { data, error } = await db
        .from('commandes')
        .update({ statut })
        .eq('id', orderId)
        .select('*')
        .single();
      if (error || !data) throw createHttpError(404, 'Commande introuvable');
      return res.json(data);
    }

    const { data: ownedEnterprises, error: entError } = await db
      .from('entreprises')
      .select('id')
      .eq('proprietaire_id', req.auth.userId);
    if (entError) throw entError;
    const ownedIds = (ownedEnterprises || []).map((row) => row.id);
    if (ownedIds.length === 0) throw createHttpError(403, 'Aucune entreprise pour ce vendeur');

    const { data, error } = await db
      .from('commandes')
      .update({ statut })
      .eq('id', orderId)
      .in('entreprise_id', ownedIds)
      .select('*')
      .single();
    if (error || !data) throw createHttpError(404, 'Commande introuvable pour cette entreprise');

    return res.json(data);
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createOrder,
  getOrders,
  getOrderDetails,
  updateOrderStatus,
};
