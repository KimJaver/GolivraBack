-- =============================================================================
-- PawaPay webhooks : journal d'événements pour idempotence + audit
-- Exécuter dans Supabase SQL Editor (une fois, idempotent).
-- =============================================================================

CREATE TABLE IF NOT EXISTS pawapay_events (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT         NOT NULL CHECK (event_type IN ('deposit', 'payout', 'refund')),
  pawapay_id      TEXT         NOT NULL,        -- depositId | payoutId | refundId
  status          TEXT,                         -- COMPLETED | FAILED | REJECTED ...
  paiement_id     UUID         REFERENCES paiements(id) ON DELETE SET NULL,
  commande_id     UUID         REFERENCES commandes(id) ON DELETE SET NULL,
  payload         JSONB        NOT NULL,
  processed_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pawapay_event UNIQUE (event_type, pawapay_id)
);

CREATE INDEX IF NOT EXISTS idx_pawapay_events_paiement ON pawapay_events(paiement_id);
CREATE INDEX IF NOT EXISTS idx_pawapay_events_commande ON pawapay_events(commande_id);
CREATE INDEX IF NOT EXISTS idx_pawapay_events_status   ON pawapay_events(status);

COMMENT ON TABLE pawapay_events IS
  'Journal des webhooks PawaPay (idempotent) — un même (event_type, pawapay_id) n''est traité qu''une fois.';

-- Recharge le cache PostgREST
NOTIFY pgrest, 'reload schema';
