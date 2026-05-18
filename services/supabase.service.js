const { createClient } = require('@supabase/supabase-js');

function decodeJwtRole(key) {
  if (!key.startsWith('eyJ')) return null;
  try {
    const payload = key.split('.')[1];
    const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const data = JSON.parse(json);
    return data.role || null;
  } catch {
    return null;
  }
}

/**
 * Vérifie que la clé serveur n'est pas une clé publique (anon / publishable).
 */
function assertServerSecretKey(key, envName) {
  const trimmed = (key || '').trim();
  if (!trimmed) {
    throw new Error(`${envName} est vide.`);
  }

  if (trimmed.startsWith('sb_publishable_')) {
    throw new Error(
      `${envName} contient une clé PUBLIQUE (sb_publishable_…). ` +
        'Utilisez la clé SECRÈTE : Supabase → Settings → API → Secret keys (sb_secret_…).',
    );
  }

  const jwtRole = decodeJwtRole(trimmed);
  if (jwtRole === 'anon') {
    throw new Error(
      `${envName} contient un JWT « anon ». Utilisez le JWT « service_role » depuis Supabase → Settings → API.`,
    );
  }
}

function resolveSupabaseServerKey() {
  const url = (process.env.SUPABASE_URL || '').trim();
  if (!url) {
    throw new Error('SUPABASE_URL manquant dans .env (ou variables Render).');
  }

  const candidates = [
    ['SUPABASE_SECRET_KEY', process.env.SUPABASE_SECRET_KEY],
    ['SUPABASE_SERVICE_KEY', process.env.SUPABASE_SERVICE_KEY],
  ].filter(([, value]) => typeof value === 'string' && value.trim());

  if (candidates.length === 0) {
    throw new Error(
      'Aucune clé Supabase serveur : définissez SUPABASE_SECRET_KEY=sb_secret_… dans .env (jamais sb_publishable_…).',
    );
  }

  const failures = [];
  for (const [envName, raw] of candidates) {
    const key = raw.trim();
    try {
      assertServerSecretKey(key, envName);
      if (failures.length > 0) {
        console.warn(`[golivra] Clé valide trouvée dans ${envName} (${failures.length} autre(s) variable(s) ignorée(s)).`);
      }
      return { url, key, envName };
    } catch (err) {
      failures.push(err.message);
    }
  }

  throw new Error(
    'Clé Supabase invalide : ' +
      failures.join(' — ') +
      ' Récupérez sb_secret_… dans Supabase → Project Settings → API → Secret keys.',
  );
}

function getSupabaseClient() {
  const { url, key } = resolveSupabaseServerKey();

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

module.exports = {
  getSupabaseClient,
  assertServerSecretKey,
  resolveSupabaseServerKey,
};
