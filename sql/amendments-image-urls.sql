-- GoLivra v3 — URLs d’images (Supabase Storage) en complément du BYTEA
-- À exécuter sur la base Supabase / PostgreSQL après le schéma v3.

ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE boutiques ADD COLUMN IF NOT EXISTS logo_url TEXT;

ALTER TABLE plats ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS image_url TEXT;
