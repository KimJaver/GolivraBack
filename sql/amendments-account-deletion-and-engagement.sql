-- ============================================================
-- Migration : suppression de compte (soft delete + anonymisation)
--             + tracking d'engagement produit (vues / clics)
-- À exécuter dans Supabase → SQL Editor
-- Idempotent : peut être rejouée sans risque.
-- ============================================================

-- ----------------------------------------------------------------
-- 1. UTILISATEURS : colonnes de suppression douce (RGPD)
-- ----------------------------------------------------------------
ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS est_supprime BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS supprime_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raison_suppression TEXT;

CREATE INDEX IF NOT EXISTS idx_utilisateurs_est_supprime
  ON utilisateurs (est_supprime)
  WHERE est_supprime = TRUE;

COMMENT ON COLUMN utilisateurs.est_supprime IS
  'Compte supprimé par l''utilisateur (anonymisé, login bloqué). Conserve les FK pour l''historique.';
COMMENT ON COLUMN utilisateurs.supprime_at IS
  'Horodatage de la demande de suppression.';

-- ----------------------------------------------------------------
-- 2. PLATS / ARTICLES : compteurs vues & clics (engagement)
-- ----------------------------------------------------------------
ALTER TABLE plats
  ADD COLUMN IF NOT EXISTS nb_vues  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nb_clics INTEGER NOT NULL DEFAULT 0;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS nb_vues  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nb_clics INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN plats.nb_vues  IS 'Nombre cumulé d''affichages du plat sur le marketplace.';
COMMENT ON COLUMN plats.nb_clics IS 'Nombre cumulé d''ajouts au panier / actions fortes.';
COMMENT ON COLUMN articles.nb_vues  IS 'Nombre cumulé d''affichages de l''article sur le marketplace.';
COMMENT ON COLUMN articles.nb_clics IS 'Nombre cumulé d''ajouts au panier / actions fortes.';

-- Fonctions d'incrément atomique (évite les races)
CREATE OR REPLACE FUNCTION increment_product_view(p_table TEXT, p_id UUID, p_amount INT DEFAULT 1)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_table = 'plats' THEN
    UPDATE plats SET nb_vues = COALESCE(nb_vues, 0) + p_amount WHERE id = p_id;
  ELSIF p_table = 'articles' THEN
    UPDATE articles SET nb_vues = COALESCE(nb_vues, 0) + p_amount WHERE id = p_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION increment_product_click(p_table TEXT, p_id UUID, p_amount INT DEFAULT 1)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_table = 'plats' THEN
    UPDATE plats SET nb_clics = COALESCE(nb_clics, 0) + p_amount WHERE id = p_id;
  ELSIF p_table = 'articles' THEN
    UPDATE articles SET nb_clics = COALESCE(nb_clics, 0) + p_amount WHERE id = p_id;
  END IF;
END;
$$;

-- ----------------------------------------------------------------
-- 3. (Optionnel) Index pour le tri par engagement (top vus)
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_plats_nb_vues_desc
  ON plats (restaurant_id, nb_vues DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_articles_nb_vues_desc
  ON articles (boutique_id, nb_vues DESC NULLS LAST);
