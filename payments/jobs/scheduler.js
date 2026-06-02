/**
 * Scheduler — Jobs paiements
 * Démarre payoutJob + escrowReleaseJob (toutes les N secondes).
 */

const payoutJob = require('./payout.job');
const escrowReleaseJob = require('./escrow-release.job');
const { info: logInfo, error: logError } = require('../../utils/logger');

const ENABLED = process.env.PAYMENTS_SCHEDULER !== '0';
const PAYOUT_INTERVAL_MS = Number(process.env.PAYOUT_JOB_INTERVAL_MS) || 30_000;
const ESCROW_INTERVAL_MS = Number(process.env.ESCROW_JOB_INTERVAL_MS) || 60_000;

let payoutTimer = null;
let escrowTimer = null;

function start() {
  if (!ENABLED) {
    logInfo({ msg: 'payments scheduler disabled (PAYMENTS_SCHEDULER=0)' });
    return;
  }
  payoutTimer = setInterval(() => {
    payoutJob.runOnce().catch((err) => logError({ msg: 'payoutJob crashed', error: err.message }));
  }, PAYOUT_INTERVAL_MS);
  payoutTimer.unref?.();

  escrowTimer = setInterval(() => {
    escrowReleaseJob.runOnce().catch((err) => logError({ msg: 'escrowReleaseJob crashed', error: err.message }));
  }, ESCROW_INTERVAL_MS);
  escrowTimer.unref?.();

  logInfo({
    msg: 'payments scheduler started',
    payout_interval_ms: PAYOUT_INTERVAL_MS,
    escrow_interval_ms: ESCROW_INTERVAL_MS,
  });
}

function stop() {
  if (payoutTimer) clearInterval(payoutTimer);
  if (escrowTimer) clearInterval(escrowTimer);
}

module.exports = { start, stop };
