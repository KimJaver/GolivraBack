const { getSupabaseClient } = require('../services/supabase.service');

function getDb() {
  return getSupabaseClient();
}

module.exports = {
  getDb,
};
