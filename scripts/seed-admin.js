#!/usr/bin/env node
/**
 * Crée ou met à jour le compte administrateur GoLivra dans Supabase (table utilisateurs).
 *
 * Usage :
 *   node scripts/seed-admin.js
 *   ADMIN_EMAIL=golivra@gmail.com ADMIN_PASSWORD=12345678 node scripts/seed-admin.js
 *
 * Prérequis : .env avec SUPABASE_URL et SUPABASE_SECRET_KEY
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getDb } = require('../config/db');

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'golivra@gmail.com').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '12345678';
const ADMIN_NOM = process.env.ADMIN_NOM || 'GoLivra Admin';
/** Téléphone réservé admin si la colonne reste NOT NULL (schéma v3 sans amendements). */
const ADMIN_TELEPHONE = process.env.ADMIN_TELEPHONE || '+242990000001';

async function main() {
  const db = getDb();

  const { data: roleRow, error: roleErr } = await db.from('roles').select('id').eq('nom', 'admin').maybeSingle();
  if (roleErr) throw roleErr;
  if (!roleRow) {
    throw new Error('Rôle admin introuvable. Exécutez d’abord le schéma SQL v3 sur Supabase.');
  }

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const { data: byEmail, error: findErr } = await db
    .from('utilisateurs')
    .select('id, email, telephone')
    .eq('email', ADMIN_EMAIL)
    .maybeSingle();
  if (findErr) throw findErr;

  const basePatch = {
    nom: ADMIN_NOM,
    mot_de_passe_hash: hash,
    role_id: roleRow.id,
    est_actif: true,
    est_approuve: true,
    est_verifie: true,
    email: ADMIN_EMAIL,
  };

  if (byEmail) {
    const { error: upErr } = await db.from('utilisateurs').update(basePatch).eq('id', byEmail.id);
    if (upErr) throw upErr;
    console.log(`[seed-admin] Compte admin mis à jour : ${ADMIN_EMAIL} (id=${byEmail.id})`);
    return;
  }

  const insertPayload = {
    ...basePatch,
    telephone: ADMIN_TELEPHONE,
  };

  let { error: insErr } = await db.from('utilisateurs').insert(insertPayload);
  if (insErr && insErr.code === '23505') {
    const { data: byPhone } = await db
      .from('utilisateurs')
      .select('id')
      .eq('telephone', ADMIN_TELEPHONE)
      .maybeSingle();
    if (byPhone) {
      const { error: upErr } = await db.from('utilisateurs').update(basePatch).eq('id', byPhone.id);
      if (upErr) throw upErr;
      console.log(`[seed-admin] Compte admin mis à jour via téléphone réservé : ${ADMIN_EMAIL}`);
      return;
    }
  }
  if (insErr) throw insErr;

  console.log(`[seed-admin] Compte admin créé : ${ADMIN_EMAIL}`);
}

main().catch((err) => {
  console.error('[seed-admin] Échec :', err.message || err);
  process.exit(1);
});
