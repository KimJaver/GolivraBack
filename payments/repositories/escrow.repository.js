/**
 * Repository — Escrows
 * Cycle de vie d'un paiement bloqué.
 */

const { rowToEscrow } = require('../entities/escrow.entity');

async function findById(db, escrowId) {
  const { data, error } = await db
    .from('escrows')
    .select('*')
    .eq('id', escrowId)
    .maybeSingle();
  if (error) throw error;
  return rowToEscrow(data);
}

async function findActiveByCommande(db, commandeId) {
  const { data, error } = await db
    .from('escrows')
    .select('*')
    .eq('commande_id', commandeId)
    .in('statut', ['en_attente', 'bloque'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return rowToEscrow(data);
}

async function findByCommande(db, commandeId) {
  const { data, error } = await db
    .from('escrows')
    .select('*')
    .eq('commande_id', commandeId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(rowToEscrow);
}

async function findBySousCommande(db, { restaurantId, boutiqueId }) {
  let q = db.from('escrows').select('*').in('statut', ['en_attente', 'bloque']);
  if (restaurantId) q = q.eq('restaurant_id', restaurantId);
  if (boutiqueId)   q = q.eq('boutique_id', boutiqueId);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).map(rowToEscrow);
}

async function create(db, payload) {
  const { data, error } = await db
    .from('escrows')
    .insert({
      commande_id: payload.commandeId,
      paiement_id: payload.paiementId || null,
      restaurant_id: payload.restaurantId || null,
      boutique_id: payload.boutiqueId || null,
      montant: payload.montantFcfa,
      commission_pct: payload.commissionPct ?? 0,
      commission_ttc: payload.commissionTtcFcfa ?? 0,
      montant_etablissement: payload.montantEtablissementFcfa ?? payload.montantFcfa,
      frais_livraison: payload.fraisLivraisonFcfa ?? 0,
      devise: payload.devise || 'XAF',
      statut: payload.statut || 'en_attente',
      metadata: payload.metadata || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToEscrow(data);
}

async function updateStatut(db, escrowId, statut, extra = {}) {
  const now = new Date().toISOString();
  const patch = { statut, updated_at: now, ...extra };
  const { data, error } = await db
    .from('escrows')
    .update(patch)
    .eq('id', escrowId)
    .select('*')
    .single();
  if (error) throw error;
  return rowToEscrow(data);
}

async function listEnAttente(db, { limit = 100 } = {}) {
  const { data, error } = await db
    .from('escrows')
    .select('*')
    .in('statut', ['en_attente', 'bloque'])
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []).map(rowToEscrow);
}

module.exports = {
  findById,
  findActiveByCommande,
  findByCommande,
  findBySousCommande,
  create,
  updateStatut,
  listEnAttente,
};
