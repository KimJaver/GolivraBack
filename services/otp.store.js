/**
 * Couche OTP compatible schéma v3 (`otp`) et legacy (`otp_codes`).
 */

let cachedTable = process.env.OTP_TABLE?.trim() || null;

function isMissingRelation(error) {
  if (!error) return false;
  const msg = String(error.message || '').toLowerCase();
  const code = String(error.code || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache') ||
    msg.includes('relation') && msg.includes('otp')
  );
}

async function resolveOtpTable(db) {
  if (cachedTable) return cachedTable;

  const forced = process.env.OTP_TABLE?.trim();
  if (forced) {
    cachedTable = forced;
    return cachedTable;
  }

  const v3Probe = await db.from('otp').select('id').limit(1);
  if (!v3Probe.error || v3Probe.error.code === 'PGRST116') {
    cachedTable = 'otp';
    return cachedTable;
  }

  if (isMissingRelation(v3Probe.error)) {
    const legacyProbe = await db.from('otp_codes').select('id').limit(1);
    if (!legacyProbe.error || legacyProbe.error.code === 'PGRST116') {
      cachedTable = 'otp_codes';
      return cachedTable;
    }
  }

  cachedTable = 'otp';
  return cachedTable;
}

async function insertOtp(db, { telephone, code, expiresAt }) {
  const table = await resolveOtpTable(db);

  if (table === 'otp') {
    return db.from('otp').insert({
      telephone,
      code,
      statut: 'en_attente',
      expire_at: expiresAt,
    });
  }

  return db.from('otp_codes').insert({
    telephone,
    code,
    expire_le: expiresAt,
  });
}

async function findPendingOtp(db, telephone, code) {
  const table = await resolveOtpTable(db);

  if (table === 'otp') {
    return db
      .from('otp')
      .select('id, code, expire_at, statut')
      .eq('telephone', telephone)
      .eq('code', code)
      .eq('statut', 'en_attente')
      .order('expire_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  return db
    .from('otp_codes')
    .select('id, code, expire_le')
    .eq('telephone', telephone)
    .eq('code', code)
    .order('expire_le', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) return { data: null, error };
      if (!data) return { data: null, error: null };
      return {
        data: {
          id: data.id,
          code: data.code,
          expire_at: data.expire_le,
          statut: 'en_attente',
        },
        error: null,
      };
    });
}

async function deleteOtpById(db, otpId) {
  const table = await resolveOtpTable(db);
  return db.from(table).delete().eq('id', otpId);
}

async function deleteOtpByPhoneAndCode(db, telephone, code) {
  const table = await resolveOtpTable(db);
  return db.from(table).delete().eq('telephone', telephone).eq('code', code);
}

function otpTableHint() {
  return cachedTable || 'otp ou otp_codes';
}

module.exports = {
  resolveOtpTable,
  insertOtp,
  findPendingOtp,
  deleteOtpById,
  deleteOtpByPhoneAndCode,
  otpTableHint,
};
