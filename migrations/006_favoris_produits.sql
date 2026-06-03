-- Favoris PRODUITS (plats + articles).
-- Separe de la table `favoris` (entreprises) car les produits sont dans
-- 2 tables distinctes (`plats` et `articles`) : pas de FK unique possible.
-- Le `produit_kind` permet de router vers la bonne table au moment du JOIN
-- cote API pour hydrate le feed de favoris.
CREATE TABLE IF NOT EXISTS favoris_produits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    produit_id UUID NOT NULL,
    produit_kind VARCHAR(20) NOT NULL CHECK (produit_kind IN ('plat', 'article')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (client_id, produit_id, produit_kind)
);

CREATE INDEX IF NOT EXISTS idx_favoris_produits_client
    ON favoris_produits (client_id, created_at DESC);

COMMENT ON TABLE favoris_produits IS 'Produits/dishes favoris d''un client (separe de favoris qui gere les entreprises).';
