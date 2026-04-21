# GolivraBack

API Node.js (Express) pour l’application **GoLivra** : authentification (OTP SMS Twilio + sessions), commandes, entreprises, produits, livraisons, administration.

## Prérequis

- Node.js **20+** (recommandé : **22**)
- Un projet [Supabase](https://supabase.com/) avec le schéma appliqué (`schema.sql` à la racine du dépôt)
- Compte [Twilio](https://www.twilio.com/) pour l’envoi des SMS OTP (optionnel en dev si vous acceptez que l’OTP soit quand même enregistré en base sans SMS)

## Installation locale

```bash
npm ci
cp .env.example .env
# Éditer .env avec vos clés
npm run dev
```

Santé de l’API : `GET http://localhost:3000/health`

## Variables d’environnement

| Variable | Description |
|----------|-------------|
| `PORT` | Port d’écoute (défaut : `3000`) |
| `NODE_ENV` | `development` ou `production` |
| `SUPABASE_URL` | URL du projet Supabase |
| `SUPABASE_SECRET_KEY` | Clé **secrète** serveur (`sb_secret_...` ou JWT **service_role**). Jamais côté client. |
| `SUPABASE_SERVICE_KEY` | (Optionnel) Alias historique de `SUPABASE_SECRET_KEY` si votre hébergeur utilise encore ce nom. |
| `TWILIO_ACCOUNT_SID` | SID Twilio |
| `TWILIO_AUTH_TOKEN` | Token Twilio |
| `TWILIO_FROM_NUMBER` | Numéro expéditeur SMS |
| `CORS_ORIGINS` | Liste d’origines séparées par des virgules (recommandé en production pour le web). Vide = autoriser toutes les origines (pratique pour les apps mobiles). |

## Déploiement sur Internet

### Option A — Docker

Construire et lancer :

```bash
docker build -t golivra-back .
docker run --env-file .env -p 3000:3000 golivra-back
```

Sur un hébergeur (Railway, Fly.io, Render, VPS, etc.), définissez les mêmes variables que dans `.env`, exposez le port **3000** (ou celui défini par `PORT`), et vérifiez que **HTTPS** est terminé devant le conteneur si besoin.

### Option B — Node directement

```bash
npm ci --omit=dev
NODE_ENV=production node server.js
```

Utilisez un gestionnaire de processus (**pm2**, **systemd**) et un reverse proxy (**Caddy**, **nginx**) avec TLS.

### Mobile / Expo

L’app mobile doit pointer vers l’URL publique de l’API, par exemple :

`EXPO_PUBLIC_API_BASE_URL=https://api.votredomaine.com`

(sans chemin `/api` ; les routes `/api/...` sont ajoutées par le client).

## Pousser le code sur GitHub

Dépôt cible : [https://github.com/KimJaver/GolivraBack](https://github.com/KimJaver/GolivraBack)

```bash
git init
git config user.email "kimjaver7@gmail.com"
git config user.name "KimJaver"
git add .
git commit -m "Initial commit: Golivra API"
git branch -M main
git remote add origin https://github.com/KimJaver/GolivraBack.git
git push -u origin main
```

Si le dépôt distant n’est pas vide, utilisez `git pull origin main --allow-unrelated-histories` avant le premier `push`, ou forcez uniquement si vous assumez d’écraser l’historique distant.

**Ne commitez jamais** le fichier `.env` (déjà ignoré par `.gitignore`).

## Licence

Projet privé — usage selon les conditions de l’équipe GoLivra.
