/**
 * Job — Escrow release
 *
 * Sécurise le flux de livraison : si un sous-commande est livrée mais que
 * l'escrow n'a pas été libéré (webhook ou erreur en aval), on le libère ici.
 *
 * Idempotent : ne fait rien si déjà libéré.
 */

const escrowRepo = require('../repositories/escrow.repository');
const escrowService = require('../services/escrow.service');
const { getDb } = require('../../config/db');
const { info: logInfo, error: logError } = require('../../utils/logger');

const ENABLED = process.env.ESCROW_AUTO_RELEASE !== '0';

async function runOnce() {
  if (!ENABLED) return { skipped: true, reason: 'ESCROW_AUTO_RELEASE=0' };
  const db = getDb();
  const escrows = await escrowRepo.listEnAttente(db, { limit: 100 });
  const results = { scanned: escrows.length, released: 0, skipped: 0, errors: 0 };

  for (const e of escrows) {
    try {
      // Vérifie que la sous-commande associée est bien livrée
      const sousCommandeId = e.metadata?.sousCommandeId;
      if (!sousCommandeId) {
        results.skipped += 1;
        continue;
      }
      const { data: sc } = await db
        .from('sous_commandes')
        .select('id, statut, livree_at')
        .eq('id', sousCommandeId)
        .maybeSingle();
      if (!sc || sc.statut !== 'livree') {
        results.skipped += 1;
        continue;
      }
      // Récupère la livraison si possible
      const { data: liv } = await db
        .from('livraisons')
        .select('*')
        .eq('sous_commande_id', sousCommandeId)
        .maybeSingle();
      await escrowService.release(db, e.id, { livraison: liv || null });
      results.released += 1;
    } catch (err) {
      results.errors += 1;
      logError({ msg: 'escrowReleaseJob_release', escrowId: e.id, error: err.message });
    }
  }

  logInfo({ msg: 'escrowReleaseJob_tick', ...results });
  return results;
}

module.exports = { runOnce };
