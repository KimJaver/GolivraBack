const { createClient } = require('@supabase/supabase-js');

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!url || !key) {
    throw new Error(
      'Supabase configuration is missing (set SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_KEY)',
    );
  }

  return createClient(url, key);
}

module.exports = {
  getSupabaseClient,
};
