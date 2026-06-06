-- Système de personnalisation algorithmique
-- Table pour collecter les interactions utilisateurs de manière structurée

CREATE TABLE IF NOT EXISTS user_interactions (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID          NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  interaction_type  VARCHAR(50)   NOT NULL, -- 'view_product', 'view_enterprise', 'search', 'category_click', 'add_to_cart'
  target_id         UUID,                   -- ID du produit ou de l'entreprise
  target_type       VARCHAR(50),            -- 'product', 'restaurant', 'boutique', 'category'
  category_id       UUID,                   -- Catégorie liée (optionnel)
  metadata          JSONB,                  -- ex: { query: 'pizza' } pour une recherche
  weight            INTEGER       NOT NULL DEFAULT 1, -- Poids de l'interaction pour le scoring
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index pour accélérer le calcul des scores par utilisateur
CREATE INDEX idx_user_interactions_user_id ON user_interactions(user_id);
CREATE INDEX idx_user_interactions_created_at ON user_interactions(created_at DESC);

-- Table de synthèse des préférences (mise à jour périodique ou à la volée)
-- Permet de stocker les scores agrégés pour une performance optimale lors de l'affichage
CREATE TABLE IF NOT EXISTS user_preferences_scores (
  user_id           UUID          NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  target_id         UUID          NOT NULL, -- ID de l'entreprise, article ou catégorie
  target_type       VARCHAR(50)   NOT NULL,
  score             DECIMAL(10,4) NOT NULL DEFAULT 0.0,
  last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, target_id, target_type)
);

-- Commentaires RGPD
COMMENT ON TABLE user_interactions IS 'Stocke les comportements utilisateurs pour la personnalisation algorithmique (RGPD: finalité d''amélioration de l''expérience utilisateur).';
COMMENT ON TABLE user_preferences_scores IS 'Scores de pertinence calculés pour chaque utilisateur (profilage comportemental).';
