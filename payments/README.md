# Module Paiements — GoLivra

Architecture refactorisée du système de paiement, escrow, commissions et retraits GoLivra, intégrée à **PawaPay**.

## Structure

```
payments/
├── entities/         # Mappers DB → objets JS
├── repositories/     # Accès SQL Supabase (lecture/écriture brute)
├── services/         # Logique métier
│   ├── commission.service.js    # Moteur de commission (ventes + livraison)
│   ├── escrow.service.js        # Cycle de vie de l'escrow (hold / release / refund)
│   ├── wallet.service.js        # Portefeuille (crédit, débit, solde, ledger)
│   ├── withdrawal.service.js    # Retraits + workflow PawaPay
│   ├── payment.service.js       # Initiation d'un paiement client
│   ├── ledger.service.js        # Écriture du registre comptable
│   └── pawapay.service.js       # Client HTTP PawaPay (deposit / payout / status)
├── webhooks/         # Handlers des webhooks PawaPay
│   ├── pawapay-deposit.webhook.js
│   ├── pawapay-payout.webhook.js
│   └── pawapay-refund.webhook.js
├── controllers/      # Contrôleurs HTTP (Express)
├── routes/           # Définitions de routes Express
├── jobs/             # Tâches automatiques (cron-like)
│   ├── payout.job.js           # Soumet les retraits en attente + refresh PawaPay
│   ├── escrow-release.job.js   # Sécurise la libération d'escrow post-livraison
│   └── scheduler.js            # Démarrage / arrêt du scheduler
└── dto/              # Validation / normalisation des payloads HTTP et webhooks
```

## Flux principal

```
Client
  │
  ▼ POST /api/orders/:orderId/pay
Payment.service.initiate()
  │
  ▼ PawaPay /deposits
... (attente)
  │
  ▼ Webhook /webhooks/pawapay/deposits (COMPLETED)
PawapayDepositWebhook
  │
  ▼ paiement.statut = 'valide'
Escrow.service.hold()       # crée escrows + crédite wallet plateforme
  │
  ▼ sous-commande livrée
Escrow.service.release()    # débite plateforme, crédite marchand + livreur
  │
  ▼ commissions conservées sur le wallet plateforme
  │
Client / Marchand / Livreur demandent un retrait
  │
  ▼ POST /api/payouts
Withdrawal.service.createRequest()
  │
  ▼ PawaPayJob (auto) : PawaPay /payouts
... (attente)
  │
  ▼ Webhook /webhooks/pawapay/payments (COMPLETED)
Withdrawal.service.completeWithdrawal()    # débite wallet + écrit ledger
```

## Tables principales

| Table | Rôle |
|-------|------|
| `portefeuilles` | Solde de chaque acteur (client, marchand, livreur, plateforme) |
| `transactions_portefeuille` | Mouvements crédit / débit sur un portefeuille |
| `ledger_entries` | Registre comptable par portefeuille (audit) |
| `escrows` | Cycle de vie d'un paiement bloqué (par sous-commande) |
| `withdrawals` | Demandes de retrait vers Mobile Money |
| `pawapay_payouts` | Journal des appels sortants à l'API PawaPay |
| `paiements` | Paiements client (avec `pawapay_deposit_id`) |

## Moteur de commission

`payments/services/commission.service.js` calcule la répartition à partir de :

- `etablissement.commission_pct` (restaurant / boutique) — si défini, utilisé tel quel
- `entrepriseLogistique.commission_pct` — idem pour les frais de livraison
- `parametres_systeme.default_sale_commission_percent` (fallback)
- `parametres_systeme.default_delivery_commission_percent` (fallback)

Le moteur est **purement fonctionnel** : on lui passe un input, il renvoie un breakdown immutable. Pour modifier les taux, il suffit de changer les paramètres plateforme ou la valeur `commission_pct` de l'établissement.

## Webhooks PawaPay

Trois endpoints :

- `POST /webhooks/pawapay/deposits` — paiement client (déclenche l'escrow)
- `POST /webhooks/pawapay/payments` — payout Mobile Money (confirme un retrait)
- `POST /webhooks/pawapay/refunds` — remboursement

Vérification de signature : `X-PawaPay-Signature: sha256=<hex>`. Le secret est `PAWAPAY_WEBHOOK_SECRET`. Si vide, la signature n'est pas vérifiée (dev only).

## Jobs automatiques

| Job | Intervalle par défaut | Rôle |
|-----|----------------------|------|
| `payoutJob` | 30 s | Soumet les retraits en attente, rafraîchit les payouts en vol |
| `escrowReleaseJob` | 60 s | Sécurise la libération d'escrow si la livraison a eu lieu |

Variables d'environnement :
- `PAYMENTS_SCHEDULER=0` — désactive les jobs
- `PAYOUT_JOB_INTERVAL_MS=30000`
- `ESCROW_JOB_INTERVAL_MS=60000`
- `PAYOUT_AUTO_ENABLED=0` — désactive la soumission auto (l'admin doit approuver)
- `ESCROW_AUTO_RELEASE=0` — désactive la libération auto

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PAWAPAY_BASE_URL` | URL de l'API PawaPay | `https://api.sandbox.pawapay.io` |
| `PAWAPAY_API_KEY` | Clé Bearer. Si vide → mode simulation | — |
| `PAWAPAY_WEBHOOK_SECRET` | Secret HMAC pour vérifier les webhooks | — |
| `PAYMENT_MODE` | `test` ou `live` | `test` |
| `MIN_RETRAIT_FCFA` | Montant minimum de retrait | `500` |
| `PAYOUT_MAX_FCFA` | Plafond de retrait | `5_000_000` |
| `PAYOUT_RETRY_MAX` | Nombre max de tentatives | `3` |
| `PAYOUT_AUTO_ENABLED` | Active le payout auto | `1` |
| `ESCROW_AUTO_RELEASE` | Active la libération auto | `1` |

## Migration SQL

Exécuter une seule fois dans Supabase SQL Editor :

```
sql/amendments-payments-refactor.sql
```

Cette migration :
1. Crée les types ENUM (`escrow_statut`, `withdrawal_statut`, etc.)
2. Ajoute des colonnes à `paiements` (`pawapay_deposit_id`, `escrow_id`, etc.)
3. Crée les tables `escrows`, `withdrawals`, `pawapay_payouts`, `ledger_entries`
4. Insère les paramètres plateforme par défaut
5. Crée la vue `v_escrows_resume`

## Rétro-compatibilité

Les anciens modules continuent de fonctionner via des wrappers :

- `services/wallet.service.js` → délègue à `payments/services/`
- `services/payment.service.js` → délègue à `payments/services/`
- `controllers/payment.controller.js` → délègue à `payments/services/`
- `controllers/wallet.controller.js` → délègue à `payments/services/`
- `controllers/pawapay-webhook.controller.js` → délègue à `payments/webhooks/`
- Ancien webhook `/webhooks/pawapay/*` → conservé comme `/webhooks/pawapay-legacy/*`

Les nouvelles routes propres sont :
- `GET /api/payouts` — historique des retraits
- `POST /api/payouts` — demande de retrait
- `GET /api/payouts/:id`
- `GET /api/payouts/info` — config publique
- `GET /api/admin/payouts` — admin
- `PATCH /api/admin/payouts/:id/approve|reject`
- `GET /api/admin/wallet/platform` — wallet plateforme (escrow, commissions, etc.)
- `GET /api/admin/escrows` — escrows en cours
- `GET /api/orders/:orderId/payment-status` — statut du paiement d'une commande
