const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      'Configuration Supabase manquante (définissez SUPABASE_URL et SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_KEY).',
    );
  }

  return createClient(url, key);
}

module.exports = {
  getSupabaseClient,
};
