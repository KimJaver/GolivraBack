/**
 * Job — Payout processor
 *
 * 1. Soumet les retraits en attente vers PawaPay
 *    (déclenche l'appel API → webhook confirmera)
 * 2. Rafraîchit le statut des payouts en cours
 *    (sécurité en cas de webhook manqué)
 */

const withdrawalService = require('../services/withdrawal.service');
const withdrawalRepo = require('../repositories/withdrawal.repository');
const pawapay = require('../services/pawapay.service');
const { getDb } = require('../../config/db');
const { info: logInfo, error: logError, warn: logWarn } = require('../../utils/logger');

const AUTO_ENABLED = process.env.PAYOUT_AUTO_ENABLED !== '0';

async function processPending(db) {
  if (!AUTO_ENABLED) return { skipped: true, reason: 'PAYOUT_AUTO_ENABLED=0' };
  const pending = await withdrawalRepo.listEnAttente(db, { limit: 50 });
  const results = { processed: 0, errors: 0 };
  for (const w of pending) {
    try {
      await withdrawalService.processWithdrawal(db, w.id, { source: 'payoutJob' });
      results.processed += 1;
    } catch (err) {
      results.errors += 1;
      logError({ msg: 'payoutJob_process', withdrawalId: w.id, error: err.message });
    }
  }
  return results;
}

async function refreshInFlight(db) {
  const inFlight = await withdrawalRepo.listPayoutsEnTraitement(db, { limit: 50 });
  const results = { refreshed: 0, completed: 0, failed: 0 };
  for (const p of inFlight) {
    if (!p.payoutId) continue;
    try {
      const res = await pawapay.getPayoutStatus(p.payoutId);
      if (!res.ok) continue;
      const remote = String(res.data?.status || '').toUpperCase();
      if (remote === 'COMPLETED') {
        await withdrawalService.completeWithdrawal(db, null, { payoutId: p.payoutId });
        results.completed += 1;
      } else if (['FAILED', 'REJECTED', 'EXPIRED'].includes(remote)) {
        await withdrawalService.failWithdrawal(db, null, `PawaPay ${remote}`);
        results.failed += 1;
      }
      results.refreshed += 1;
    } catch (err) {
      logWarn({ msg: 'payoutJob_refresh', payoutId: p.payoutId, error: err.message });
    }
  }
  return results;
}

async function runOnce() {
  const db = getDb();
  const submitted = await processPending(db);
  const refreshed = await refreshInFlight(db);
  logInfo({ msg: 'payoutJob_tick', submitted, refreshed });
  return { submitted, refreshed };
}

module.exports = { runOnce, processPending, refreshInFlight };
