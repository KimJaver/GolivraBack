/**
 * Repository — Paiements
 */

const { rowToPayment } = require('../entities/payment.entity');

async function findById(db, paiementId) {
  const { data, error } = await db
    .from('paiements')
    .select('*')
    .eq('id', paiementId)
    .maybeSingle();
  if (error) throw error;
  return rowToPayment(data);
}

async function findByDepositId(db, depositId) {
  if (!depositId) return null;
  const { data, error } = await db
    .from('paiements')
    .select('*')
    .eq('pawapay_deposit_id', depositId)
    .maybeSingle();
  if (error) throw error;
  return rowToPayment(data);
}

async function findLatestForCommande(db, commandeId) {
  const { data, error } = await db
    .from('paiements')
    .select('*')
    .eq('commande_id', commandeId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return rowToPayment(data);
}

async function create(db, payload) {
  const { data, error } = await db
    .from('paiements')
    .insert({
      commande_id: payload.commandeId,
      utilisateur_id: payload.utilisateurId,
      montant: payload.montantFcfa,
      methode: payload.methode,
      statut: payload.statut || 'en_attente',
      reference_externe: payload.referenceExterne || null,
      numero_transaction: payload.numeroTransaction || null,
      pawapay_deposit_id: payload.pawapayDepositId || null,
      provider_country: payload.providerCountry || null,
      provider_correspondent: payload.providerCorrespondent || null,
      metadata: payload.metadata || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return rowToPayment(data);
}

async function update(db, paiementId, patch) {
  const { data, error } = await db
    .from('paiements')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', paiementId)
    .select('*')
    .single();
  if (error) throw error;
  return rowToPayment(data);
}

module.exports = { findById, findByDepositId, findLatestForCommande, create, update };
