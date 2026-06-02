/**
 * Entity — Portefeuille (Wallet)
 * Mappage ligne Supabase → objet JS normalisé.
 */

function rowToWallet(row) {
  if (!row) return null;
  return {
    id: row.id,
    utilisateurId: row.utilisateur_id,
    soldeFcfa: Number(row.solde ?? 0),
    soldeEnAttenteFcfa: Number(row.solde_en_attente ?? 0),
    devise: row.devise || 'XAF',
    estActif: row.est_actif !== false,
    creeLe: row.created_at,
    misAJourLe: row.updated_at,
  };
}

module.exports = { rowToWallet };
