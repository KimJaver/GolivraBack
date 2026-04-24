const { getDb } = require('../config/db');
const bcrypt = require('bcryptjs');
const { createHttpError, requireFields } = require('../utils/http');
const { generateToken } = require('../utils/token');

const PUBLIC_REGISTER_ROLES = new Set(['client', 'vendeur']);

/**
 * Retrouve un OTP valide (téléphone + code, non expiré). Ne supprime rien :
 * la suppression a lieu uniquement après une authentification / inscription réussie,
 * pour éviter les comptes orphelins si l’insertion de session échoue.
 */
async function findValidOtpRow(db, telephone, code) {
  const { data: otpRow, error } = await db
    .from('otp_codes')
    .select('id, expire_le, code')
    .eq('telephone', telephone)
    .eq('code', code)
    .order('expire_le', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !otpRow) throw createHttpError(400, 'Code de vérification introuvable ou incorrect');
  if (new Date(otpRow.expire_le) <= new Date()) throw createHttpError(400, 'Le code de vérification a expiré');
  if (String(otpRow.code) !== String(code)) throw createHttpError(400, 'Code de vérification incorrect');

  return otpRow;
}

async function deleteOtpRow(db, otpId) {
  const { error: deleteError } = await db.from('otp_codes').delete().eq('id', otpId);
  if (deleteError) throw deleteError;
}

async function register(req, res, next) {
  try {
    const rawRole = req.body.role;
    const role = typeof rawRole === 'string' && rawRole.trim() ? rawRole.trim() : 'client';
    const { nom, telephone, motDePasse, otpCode } = req.body;
    requireFields(req.body, ['nom', 'telephone', 'motDePasse', 'otpCode']);

    const db = getDb();
    if (!PUBLIC_REGISTER_ROLES.has(role)) {
      throw createHttpError(403, 'Inscription réservée aux comptes client ou professionnel.');
    }

    const otpRow = await findValidOtpRow(db, telephone, otpCode);

    const { data: roleRow, error: roleError } = await db
      .from('roles')
      .select('id')
      .eq('nom', role)
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (roleError || !roleRow) throw createHttpError(400, 'Profil demandé non reconnu.');
    const hashedPassword = await bcrypt.hash(motDePasse, 10);

    const { data, error } = await db
      .from('utilisateurs')
      .insert({
        nom,
        telephone,
        mot_de_passe: hashedPassword,
        role_id: roleRow.id,
      })
      .select('id, nom, telephone, role_id, cree_le')
      .single();

    if (error) {
      if (error.code === '23505') throw createHttpError(409, 'Ce numéro de téléphone est déjà enregistré');
      throw error;
    }

    const token = generateToken();
    const expireDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const { error: sessionError } = await db.from('sessions').insert({
      utilisateur_id: data.id,
      token,
      expire_le: expireDate.toISOString(),
    });
    if (sessionError) {
      await db.from('utilisateurs').delete().eq('id', data.id);
      throw sessionError;
    }

    await deleteOtpRow(db, otpRow.id);

    return res.status(201).json({
      token,
      expireLe: expireDate.toISOString(),
      user: {
        id: data.id,
        nom: data.nom,
        telephone: data.telephone,
        roleId: data.role_id,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function login(req, res, next) {
  try {
    const { telephone, motDePasse } = req.body;
    requireFields(req.body, ['telephone', 'motDePasse']);

    const db = getDb();

    const { data: user, error } = await db
      .from('utilisateurs')
      .select('id, nom, telephone, mot_de_passe, role_id')
      .eq('telephone', telephone)
      .single();

    if (error || !user) {
      throw createHttpError(401, 'Téléphone ou mot de passe incorrect');
    }

    const isBcryptHash = user.mot_de_passe.startsWith('$2a$') || user.mot_de_passe.startsWith('$2b$');
    const passwordValid = isBcryptHash ? await bcrypt.compare(motDePasse, user.mot_de_passe) : user.mot_de_passe === motDePasse;
    if (!passwordValid) {
      throw createHttpError(401, 'Téléphone ou mot de passe incorrect');
    }

    // Progressive migration for old plain-text records.
    if (!isBcryptHash) {
      const upgradedHash = await bcrypt.hash(motDePasse, 10);
      await db.from('utilisateurs').update({ mot_de_passe: upgradedHash }).eq('id', user.id);
    }

    const token = generateToken();
    const expireDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const { error: sessionError } = await db.from('sessions').insert({
      utilisateur_id: user.id,
      token,
      expire_le: expireDate.toISOString(),
    });
    if (sessionError) throw sessionError;

    return res.json({
      token,
      expireLe: expireDate.toISOString(),
      user: {
        id: user.id,
        nom: user.nom,
        telephone: user.telephone,
        roleId: user.role_id,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function me(req, res, next) {
  try {
    const db = getDb();
    const { data: user, error } = await db
      .from('utilisateurs')
      .select('id, nom, telephone, role_id, cree_le')
      .eq('id', req.auth.userId)
      .single();

    if (error || !user) throw createHttpError(404, 'Utilisateur introuvable');
    return res.json(user);
  } catch (error) {
    return next(error);
  }
}

async function logout(req, res, next) {
  try {
    const db = getDb();
    await db.from('sessions').delete().eq('id', req.auth.sessionId);
    return res.json({ message: 'Déconnexion réussie' });
  } catch (error) {
    return next(error);
  }
}

module.exports = { register, login, me, logout };
