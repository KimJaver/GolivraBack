-- =============================================================================
-- GoLivra — Correctifs Supabase fréquents
-- 1) Table OTP (v3 `otp` ou legacy `otp_codes`)
-- 2) Bucket Storage pour les images d'inscription
-- Exécuter dans Supabase → SQL Editor
-- =============================================================================

-- ── Option A : vous avez seulement otp_codes (ancien schéma) ──
CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telephone  VARCHAR(20),
  code       VARCHAR(10),
  expire_le  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_telephone_code ON otp_codes (telephone, code);

-- ── Option B : table v3 recommandée ──
DO $$ BEGIN
  CREATE TYPE otp_statut AS ENUM ('en_attente', 'verifie', 'expire');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS otp (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telephone  VARCHAR(20) NOT NULL,
  code       VARCHAR(10) NOT NULL,
  statut     otp_statut NOT NULL DEFAULT 'en_attente',
  tentatives SMALLINT NOT NULL DEFAULT 0,
  expire_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otp_telephone ON otp(telephone);
CREATE INDEX IF NOT EXISTS idx_otp_expire_at ON otp(expire_at);

-- Migrer otp_codes → otp si des lignes existent
INSERT INTO otp (telephone, code, statut, expire_at)
SELECT telephone, code, 'en_attente', COALESCE(expire_le, NOW() + INTERVAL '10 minutes')
FROM otp_codes
WHERE telephone IS NOT NULL AND code IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM otp o
    WHERE o.telephone = otp_codes.telephone AND o.code = otp_codes.code
  );

-- ── Storage : bucket public pour logos / photos ──
-- (Si erreur "already exists", ignorez.)
INSERT INTO storage.buckets (id, name, public)
VALUES ('public', 'public', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Politique lecture publique
DROP POLICY IF EXISTS "Public read golivra uploads" ON storage.objects;
CREATE POLICY "Public read golivra uploads"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'public');

-- Politique écriture service role (API backend utilise la clé secrète)
DROP POLICY IF EXISTS "Service upload golivra" ON storage.objects;
CREATE POLICY "Service upload golivra"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'public');
