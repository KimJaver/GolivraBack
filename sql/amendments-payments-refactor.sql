-- =============================================================================
-- GoLivra — Refactor du module Paiements
--   - Nouvelle table `escrows` (cycle de vie d'un paiement bloqué)
--   - Nouvelle table `withdrawals` (retraits + intégration PawaPay)
--   - Nouvelle table `pawapay_payouts` (appels sortants vers PawaPay)
--   - Nouvelle table `ledger_entries` (registre comptable par portefeuille)
--   - Colonnes complémentaires sur `paiements`
--   - Paramètres plateforme : commissions par défaut (ventes + livraison)
--
-- Idempotent : sûr à ré-exécuter.
-- =============================================================================

-- ─────────────────────────────────────────────
-- 1. TYPES ÉNUMÉRÉS
-- ─────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE escrow_statut AS ENUM (
    'en_attente',
    'bloque',
    'libere',
    'rembourse',
    'annule'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE withdrawal_statut AS ENUM (
    'en_attente',
    'en_traitement',
    'reussi',
    'echoue',
    'rejete',
    'annule'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE withdrawal_methode AS ENUM (
    'airtel_money',
    'mtn_money',
    'mobile_money_autre',
    'virement_bancaire'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payout_statut AS ENUM (
    'en_attente',
    'soumis',
    'en_traitement',
    'reussi',
    'echoue',
    'expire'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM (
    'deposit',        -- argent entrant (paiement client)
    'escrow_hold',    -- mise en escrow (bloqué sur le portefeuille plateforme)
    'escrow_release', -- sortie d'escrow vers le marchand / livreur
    'escrow_refund',  -- restitution d'escrow au client
    'sale_credit',    -- vente créditée au marchand
    'delivery_credit',-- livraison créditée au livreur / entreprise logistique
    'commission',     -- commission prélevée (GoLivra)
    'payout',         -- retrait vers Mobile Money
    'payout_fee',     -- frais sur payout
    'adjustment',     -- ajustement manuel (admin)
    'reversal'        -- annulation d'une opération précédente
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────
-- 2. PAIEMENTS — colonnes complémentaires
-- ─────────────────────────────────────────────

ALTER TABLE paiements
  ADD COLUMN IF NOT EXISTS pawapay_deposit_id  TEXT,
  ADD COLUMN IF NOT EXISTS pawapay_payout_id   TEXT,
  ADD COLUMN IF NOT EXISTS escrow_id           UUID,
  ADD COLUMN IF NOT EXISTS provider_country    VARCHAR(8),
  ADD COLUMN IF NOT EXISTS provider_correspondent VARCHAR(32),
  ADD COLUMN IF NOT EXISTS failure_reason      TEXT,
  ADD COLUMN IF NOT EXISTS refunded_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_paiements_pawapay_deposit ON paiements(pawapay_deposit_id)
  WHERE pawapay_deposit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_paiements_pawapay_payout  ON paiements(pawapay_payout_id)
  WHERE pawapay_payout_id IS NOT NULL;


-- ─────────────────────────────────────────────
-- 3. ESCROWS — cycle de vie d'un paiement bloqué
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS escrows (
  id              UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  commande_id     UUID          NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  paiement_id     UUID          REFERENCES paiements(id) ON DELETE SET NULL,
  -- Établissement destinataire (sous-commande résolue) — utile pour la répartition
  restaurant_id   UUID          REFERENCES restaurants(id) ON DELETE SET NULL,
  boutique_id     UUID          REFERENCES boutiques(id)   ON DELETE SET NULL,
  -- Montants figés au moment de la mise en escrow
  montant         DECIMAL(12,2) NOT NULL CHECK (montant > 0),
  commission_pct  DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  commission_ttc  DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  montant_etablissement DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  frais_livraison DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  devise          VARCHAR(5)    NOT NULL DEFAULT 'XAF',
  statut          escrow_statut NOT NULL DEFAULT 'en_attente',
  -- Traçabilité
  bloque_at       TIMESTAMPTZ,
  libere_at       TIMESTAMPTZ,
  rembourse_at    TIMESTAMPTZ,
  annule_at       TIMESTAMPTZ,
  reference_externe TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_escrow_etablissement CHECK (
    (restaurant_id IS NOT NULL AND boutique_id IS NULL) OR
    (boutique_id IS NOT NULL AND restaurant_id IS NULL) OR
    (restaurant_id IS NULL AND boutique_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_escrows_commande_id ON escrows(commande_id);
CREATE INDEX IF NOT EXISTS idx_escrows_paiement_id ON escrows(paiement_id);
CREATE INDEX IF NOT EXISTS idx_escrows_statut      ON escrows(statut);
CREATE INDEX IF NOT EXISTS idx_escrows_restaurant  ON escrows(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_escrows_boutique    ON escrows(boutique_id);

COMMENT ON TABLE escrows IS
  'Paiements client temporairement bloqués sur le portefeuille GoLivra. Libérés ou remboursés à la livraison / annulation.';


-- ─────────────────────────────────────────────
-- 4. WITHDRAWALS — demandes de retrait + intégration PawaPay
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS withdrawals (
  id                  UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
  portefeuille_id     UUID                NOT NULL REFERENCES portefeuilles(id),
  utilisateur_id      UUID                NOT NULL REFERENCES utilisateurs(id),
  -- Montant demandé
  montant             DECIMAL(12,2)       NOT NULL CHECK (montant > 0),
  devise              VARCHAR(5)          NOT NULL DEFAULT 'XAF',
  -- Destination
  methode             withdrawal_methode  NOT NULL DEFAULT 'airtel_money',
  numero_compte       VARCHAR(50)         NOT NULL,
  nom_beneficiaire    VARCHAR(150),
  -- Cycle de vie
  statut              withdrawal_statut   NOT NULL DEFAULT 'en_attente',
  motif_rejet         TEXT,
  note_demandeur      TEXT,
  note_admin          TEXT,
  -- Traçabilité PawaPay
  payout_id           TEXT,                                   -- payoutId PawaPay
  payout_failure_reason TEXT,
  tentatives          SMALLINT            NOT NULL DEFAULT 0,
  -- Audit
  traite_par          UUID                REFERENCES utilisateurs(id),
  traite_at           TIMESTAMPTZ,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_utilisateur    ON withdrawals(utilisateur_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_portefeuille   ON withdrawals(portefeuille_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_statut         ON withdrawals(statut);
CREATE INDEX IF NOT EXISTS idx_withdrawals_payout_id      ON withdrawals(payout_id)
  WHERE payout_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_withdrawals_created        ON withdrawals(created_at DESC);

COMMENT ON TABLE withdrawals IS
  'Demandes de retrait du portefeuille interne vers Mobile Money. Pilotées par le payoutJob et les webhooks PawaPay.';


-- ─────────────────────────────────────────────
-- 5. PAWAPAY PAYOUTS — journal des appels sortants
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pawapay_payouts (
  id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  withdrawal_id     UUID          NOT NULL REFERENCES withdrawals(id) ON DELETE CASCADE,
  payout_id         TEXT          UNIQUE,                                 -- identifiant PawaPay
  statut            payout_statut NOT NULL DEFAULT 'en_attente',
  montant           DECIMAL(12,2) NOT NULL,
  devise            VARCHAR(5)    NOT NULL DEFAULT 'XAF',
  methode           VARCHAR(50)   NOT NULL,
  numero_compte     VARCHAR(50)   NOT NULL,
  pays              VARCHAR(8)    NOT NULL DEFAULT 'CG',
  correspondant     VARCHAR(32),
  -- Requête envoyée
  request_payload   JSONB,
  -- Réponse / état
  response_payload  JSONB,
  erreur            TEXT,
  -- Audit
  soumis_at         TIMESTAMPTZ,
  termine_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pawapay_payouts_withdrawal ON pawapay_payouts(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_pawapay_payouts_statut     ON pawapay_payouts(statut);
CREATE INDEX IF NOT EXISTS idx_pawapay_payouts_payout_id  ON pawapay_payouts(payout_id);

COMMENT ON TABLE pawapay_payouts IS
  'Journal des appels à l''API PawaPay (payouts). Permet la réconciliation via webhooks et le retry par le payoutJob.';


-- ─────────────────────────────────────────────
-- 6. LEDGER ENTRIES — registre comptable par portefeuille
-- ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ledger_entries (
  id                UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  portefeuille_id   UUID              NOT NULL REFERENCES portefeuilles(id),
  -- Sens : crédit (+) ou débit (−)
  sens              VARCHAR(6)        NOT NULL CHECK (sens IN ('credit', 'debit')),
  montant           DECIMAL(12,2)     NOT NULL CHECK (montant > 0),
  solde_avant       DECIMAL(12,2)     NOT NULL,
  solde_apres       DECIMAL(12,2)     NOT NULL,
  devise            VARCHAR(5)        NOT NULL DEFAULT 'XAF',
  -- Type d'opération (granularité fine pour audit)
  type              ledger_entry_type NOT NULL,
  -- Référence à l'entité métier d'origine (commande, sous-commande, livraison, retrait, etc.)
  reference_type    VARCHAR(50),
  reference_id      UUID,
  -- Lien vers l'écriture interne (transactions_portefeuille) pour jointure
  transaction_portefeuille_id UUID REFERENCES transactions_portefeuille(id) ON DELETE SET NULL,
  description       TEXT,
  metadata          JSONB,
  created_at        TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_portefeuille   ON ledger_entries(portefeuille_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_type           ON ledger_entries(type);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_reference      ON ledger_entries(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_created        ON ledger_entries(created_at DESC);

COMMENT ON TABLE ledger_entries IS
  'Registre comptable par portefeuille — une ligne par mouvement. Permet de répondre à « pourquoi le wallet affiche X FCFA ? ».';


-- ─────────────────────────────────────────────
-- 7. PAIEMENTS — référence vers escrow
-- ─────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE paiements
    ADD CONSTRAINT fk_paiements_escrow FOREIGN KEY (escrow_id) REFERENCES escrows(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ─────────────────────────────────────────────
-- 8. PARAMÈTRES PLATEFORME — commissions par défaut
-- ─────────────────────────────────────────────

INSERT INTO parametres_systeme (cle, valeur, type, description, est_public) VALUES
  ('default_sale_commission_percent',     '0',   'number', 'Commission GoLivra par défaut sur les ventes produits (%)', FALSE),
  ('default_delivery_commission_percent', '20',  'number', 'Commission GoLivra par défaut sur les frais de livraison (%)', FALSE),
  ('payout_auto_enabled',                 '1',   'boolean', 'Active le payoutJob (envoi auto vers PawaPay)', FALSE),
  ('payout_min_fcfa',                     '500', 'number', 'Montant minimum de retrait automatique (FCFA)', FALSE),
  ('payout_max_fcfa',                     '5000000', 'number', 'Plafond de retrait par opération (FCFA)', FALSE),
  ('payout_retry_max',                    '3',   'number', 'Nombre max de tentatives pour un payout échoué', FALSE),
  ('escrow_auto_release',                 '1',   'boolean', 'Active la libération automatique d''escrow à la livraison', FALSE)
ON CONFLICT (cle) DO UPDATE SET
  valeur      = EXCLUDED.valeur,
  description = EXCLUDED.description,
  updated_at  = NOW();


-- ─────────────────────────────────────────────
-- 9. VUE — soldes escrow par commande
-- ─────────────────────────────────────────────

CREATE OR REPLACE VIEW v_escrows_resume AS
SELECT
  c.id                                       AS commande_id,
  c.numero                                   AS commande_numero,
  COUNT(e.id)                                AS nb_escrows,
  COALESCE(SUM(e.montant) FILTER (WHERE e.statut = 'bloque'), 0)    AS escrows_bloques,
  COALESCE(SUM(e.montant) FILTER (WHERE e.statut = 'libere'), 0)    AS escrows_libere,
  COALESCE(SUM(e.montant) FILTER (WHERE e.statut = 'rembourse'), 0) AS escrows_rembourse,
  COALESCE(SUM(e.commission_ttc) FILTER (WHERE e.statut = 'libere'), 0) AS commissions_percues
FROM commandes c
LEFT JOIN escrows e ON e.commande_id = c.id
GROUP BY c.id, c.numero;


-- ─────────────────────────────────────────────
-- 10. Recharge le cache PostgREST
-- ─────────────────────────────────────────────
NOTIFY pgrest, 'reload schema';
