const { sendSms } = require('../services/twilio.service');
const { getDb } = require('../config/db');
const { requireFields, createHttpError } = require('../utils/http');

function buildOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function isOtpTestModeEnabled() {
  return process.env.OTP_TEST_MODE === '1' || process.env.OTP_TEST_MODE === 'true';
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
    });
    if (error) {
      throw createHttpError(
        500,
        `Impossible de générer le code de vérification. Vérifiez la table otp_codes (détail: ${error.message}).`,
      );
    }

    if (isOtpTestModeEnabled()) {
      return res.json({
        message: 'Code OTP généré (mode test).',
        testMode: true,
        otpCode: code,
      });
    }

    try {
      await sendSms(telephone, `Your Golivra OTP code is ${code}`);
    } catch (smsError) {
      // Ne pas laisser un OTP "fantôme" en base si le SMS n'est pas parti.
      try {
        await db.from('otp_codes').delete().eq('telephone', telephone).eq('code', code);
      } catch (cleanupError) {
        console.warn('Rollback OTP impossible après échec SMS :', cleanupError.message);
      }
      throw createHttpError(
        503,
        `Impossible d’envoyer le SMS de vérification pour le moment. Vérifiez la configuration SMS et réessayez. Détail: ${smsError.message}`,
      );
    }

    return res.json({ message: 'Code OTP envoyé', testMode: false });
  } catch (error) {
    if (error && (error.status || error.statusCode)) {
      return next(error);
    }
    return next(
      createHttpError(
        500,
        `Erreur OTP côté base/configuration. Détail: ${error?.message || 'inconnu'}`,
      ),
    );
  }
}

async function verifyOtp(req, res, next) {
  try {
    const { telephone, code } = req.body;
    requireFields(req.body, ['telephone', 'code']);

    const db = getDb();
    const { data: otpRow, error } = await db
      .from('otp_codes')
      .select('id, code, expire_le')
      .eq('telephone', telephone)
      .eq('code', code)
      .order('expire_le', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !otpRow) throw createHttpError(400, 'Code de vérification introuvable ou incorrect');
    if (new Date(otpRow.expire_le) <= new Date()) throw createHttpError(400, 'Le code de vérification a expiré');
    if (String(otpRow.code) !== String(code)) throw createHttpError(400, 'Code de vérification incorrect');

    return res.json({ verified: true });
  } catch (error) {
    if (error && (error.status || error.statusCode)) {
      return next(error);
    }
    return next(
      createHttpError(
        500,
        `Erreur de vérification OTP côté base/configuration. Détail: ${error?.message || 'inconnu'}`,
      ),
    );
  }
}

module.exports = {
  requestOtp,
  verifyOtp,
};
