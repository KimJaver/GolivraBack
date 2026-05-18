-- =============================================================================
-- GoLivra v3 — Amendements authentification « multi-canal »
-- Contexte :
--   - App mobile : clients / restaurateurs / commerçants / livreurs → téléphone + OTP.
--   - Plateforme web (admin, entreprises logistiques) : email + mot de passe
--     (2FA optionnel) — pas d’OTP SMS obligatoire pour se connecter.
--
-- À appliquer APRÈS le schéma v3 de base, ou à fusionner dans votre fichier maître.
-- Vérifiez les noms de contraintes existants (\d utilisateurs en psql) avant DROP.
-- =============================================================================

-- ─────────────────────────────────────────────
-- 1. Téléphone plus obligatoire pour tous les rôles
--    Remplacement de UNIQUE global par index partiel (plusieurs NULL autorisés
--    en SQL, mais un seul enregistrement avec un même numéro non NULL).
-- ─────────────────────────────────────────────

ALTER TABLE utilisateurs
  ALTER COLUMN telephone DROP NOT NULL;

-- Supprimer la contrainte UNIQUE implicite sur telephone si elle existe (nom typique)
ALTER TABLE utilisateurs DROP CONSTRAINT IF EXISTS utilisateurs_telephone_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_utilisateurs_telephone_non_null
  ON utilisateurs (telephone)
  WHERE telephone IS NOT NULL AND btrim(telephone) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_utilisateurs_email_non_null
  ON utilisateurs (email)
  WHERE email IS NOT NULL AND btrim(email) <> '';

-- ─────────────────────────────────────────────
-- 2. Règle métier : canal d’identité selon le rôle
--    admin → email obligatoire, téléphone optionnel (contact)
--    autres rôles « terrain » → téléphone obligatoire (OTP / login app)
--    (restaurateur, commercant, livreur, client)
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION trg_validate_utilisateur_identite()
RETURNS TRIGGER AS $$
DECLARE
  r role_nom;
BEGIN
  SELECT nom INTO r FROM roles WHERE id = NEW.role_id;
  IF r IS NULL THEN
    RAISE EXCEPTION 'role_id invalide';
  END IF;

  IF r = 'admin' THEN
    IF NEW.email IS NULL OR btrim(NEW.email) = '' THEN
      RAISE EXCEPTION 'Pour le rôle admin, l’email est obligatoire (connexion web).';
    END IF;
    -- téléphone optionnel (utile pour support / 2FA SMS futur)
  ELSE
    IF NEW.telephone IS NULL OR btrim(NEW.telephone) = '' THEN
      RAISE EXCEPTION 'Pour le rôle %, le téléphone est obligatoire.', r;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_utilisateurs_identite ON utilisateurs;
CREATE TRIGGER trg_utilisateurs_identite
  BEFORE INSERT OR UPDATE OF role_id, telephone, email ON utilisateurs
  FOR EACH ROW
  EXECUTE FUNCTION trg_validate_utilisateur_identite();

-- ─────────────────────────────────────────────
-- 3. Extensions « staff » (admin web, 2FA, audit)
--    Option A recommandée : une ligne par utilisateur admin (1–1).
--    Les gestionnaires logistique restent des utilisateurs avec rôle approprié
--    (ex. futur rôle « gestionnaire_logistique ») ou restaurateur/commercant
--    selon votre produit — même table, pas besoin d’OTP si vous choisissez
--    email+mot de passe pour eux aussi (étendre le trigger ci-dessus).
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profils_staff_web (
  utilisateur_id UUID PRIMARY KEY REFERENCES utilisateurs(id) ON DELETE CASCADE,
  -- 2FA TOTP (secret : à chiffrer côté application ou via pgcrypto + clé serveur)
  totp_secret     TEXT,
  totp_active     BOOLEAN NOT NULL DEFAULT FALSE,
  totp_verifie_at TIMESTAMPTZ,
  -- Sécurité session web (ex. préférences devices, dernier login web) — pas de secrets en clair
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE profils_staff_web IS
  'Données complémentaires pour comptes « staff web » (priorité admin). '
  'Une ligne optionnelle par utilisateur ; l’API doit refuser l’insert si role_id ≠ admin '
  '(ou étendre à un futur rôle gestionnaire_logistique_web).';

CREATE OR REPLACE FUNCTION trg_profils_staff_web_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_profils_staff_web_updated_at ON profils_staff_web;
CREATE TRIGGER trg_profils_staff_web_updated_at
  BEFORE UPDATE ON profils_staff_web
  FOR EACH ROW
  EXECUTE FUNCTION trg_profils_staff_web_updated_at();

-- ─────────────────────────────────────────────
-- 4. OTP : reste lié au téléphone — normal pour la base mobile.
--    Les admins ne passent PAS par cette table pour se connecter au back-office :
--    flux séparé POST /api/auth/staff/login (email + password) à implémenter côté Node.
-- ─────────────────────────────────────────────

COMMENT ON TABLE otp IS
  'OTP SMS / téléphone — pour inscription et login « terrain », pas pour les comptes admin email-only.';

