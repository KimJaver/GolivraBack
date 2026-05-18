#!/usr/bin/env node
/**
 * Vérifie SUPABASE_URL + clé secrète avant démarrage.
 * Usage : node scripts/check-env.js
 */
require('dotenv').config();
const { resolveSupabaseServerKey } = require('../services/supabase.service');

try {
  const { envName, url } = resolveSupabaseServerKey();
  console.log(`[check-env] OK — ${url} (clé via ${envName})`);
  process.exit(0);
} catch (err) {
  console.error('[check-env] ÉCHEC —', err.message);
  process.exit(1);
}
