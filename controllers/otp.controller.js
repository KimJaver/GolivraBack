const { sendSms } = require('../services/twilio.service');
const { getDb } = require('../config/db');
const { requireFields, createHttpError } = require('../utils/http');

function buildOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function requestOtp(req, res, next) {
  try {
    const { telephone } = req.body;
    requireFields(req.body, ['telephone']);

    const code = buildOtpCode();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const db = getDb();

    const { error } = await db.from('otp_codes').insert({
      telephone,
      code,
      expire_le: expiresAt,
      valide: false,
    });
    if (error) throw error;

    try {
      await sendSms(telephone, `Your Golivra OTP code is ${code}`);
    } catch (smsError) {
      // OTP stays valid even if SMS provider is down.
      console.warn('Unable to send OTP SMS:', smsError.message);
    }

    return res.json({ message: 'OTP sent' });
  } catch (error) {
    return next(error);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const { telephone, code } = req.body;
    requireFields(req.body, ['telephone', 'code']);

    const db = getDb();
    const { data: otpRow, error } = await db
      .from('otp_codes')
      .select('id, code, expire_le, valide')
      .eq('telephone', telephone)
      .eq('code', code)
      .order('expire_le', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !otpRow) throw createHttpError(400, 'No OTP request found');
    if (otpRow.valide) throw createHttpError(400, 'OTP already used');
    if (new Date(otpRow.expire_le) <= new Date()) throw createHttpError(400, 'OTP expired');
    if (otpRow.code !== code) throw createHttpError(400, 'Invalid OTP');

    const { error: updateError } = await db.from('otp_codes').update({ valide: true }).eq('id', otpRow.id);
    if (updateError) throw updateError;

    return res.json({ verified: true });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requestOtp,
  verifyOtp,
};
