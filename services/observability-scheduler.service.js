const endpointHealth = require('../services/endpoint-health.service');
const alerting = require('../services/alerting.service');
const { info: logInfo, error: logError } = require('../utils/logger');

const ENABLED = process.env.OBSERVABILITY_SCHEDULER !== '0';
const RULES_INTERVAL_MS = Number(process.env.OBSERVABILITY_RULES_INTERVAL_MS) || 60 * 1000; // 1 min
const SNAPSHOT_INTERVAL_MS = Number(process.env.OBSERVABILITY_SNAPSHOT_INTERVAL_MS) || 60 * 60 * 1000; // 1h

let rulesTimer = null;
let snapshotTimer = null;

function start() {
  if (!ENABLED) {
    logInfo({ msg: 'observability scheduler disabled (OBSERVABILITY_SCHEDULER=0)' });
    return;
  }

  rulesTimer = setInterval(async () => {
    try {
      const result = await alerting.evaluateRules();
      if (result.fired > 0) {
        logInfo({ msg: 'alerting rules evaluated', fired: result.fired, evaluated: result.evaluated });
      }
    } catch (err) {
      logError({ msg: 'alerting evaluateRules failed', error: err.message });
    }
  }, RULES_INTERVAL_MS);
  rulesTimer.unref?.();

  snapshotTimer = setInterval(async () => {
    try {
      await endpointHealth.persistHourlySnapshot();
    } catch (err) {
      logError({ msg: 'endpoint snapshot failed', error: err.message });
    }
  }, SNAPSHOT_INTERVAL_MS);
  snapshotTimer.unref?.();

  logInfo({
    msg: 'observability scheduler started',
    rules_interval_ms: RULES_INTERVAL_MS,
    snapshot_interval_ms: SNAPSHOT_INTERVAL_MS,
  });
}

function stop() {
  if (rulesTimer) clearInterval(rulesTimer);
  if (snapshotTimer) clearInterval(snapshotTimer);
}

module.exports = { start, stop };
