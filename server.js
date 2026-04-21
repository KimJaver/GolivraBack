require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth.routes');
const otpRoutes = require('./routes/otp.routes');
const orderRoutes = require('./routes/order.routes');
const deliveryRoutes = require('./routes/delivery.routes');
const enterpriseRoutes = require('./routes/enterprise.routes');
const productRoutes = require('./routes/product.routes');
const adminRoutes = require('./routes/admin.routes');
const { getDb } = require('./config/db');

const app = express();

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    const raw = process.env.CORS_ORIGINS;
    if (!raw || !raw.trim()) {
      return callback(null, true);
    }
    const allowed = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origine refusée par CORS : ${origin}`));
  },
};

app.use(cors(corsOptions));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'golivra-backend' });
});

app.use('/api/auth', authRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/delivery', deliveryRoutes);
app.use('/api/enterprises', enterpriseRoutes);
app.use('/api/products', productRoutes);
app.use('/api/admin', adminRoutes);

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  let message = err.message || 'Erreur interne du serveur';
  let code = err.code || 'ERREUR_INTERNE';

  if (!err.status && !err.statusCode && err.code) {
    if (err.code === '23505') {
      message = 'Cette ressource existe déjà (contrainte d’unicité).';
      code = 'CONFLIT_DONNEES';
    } else if (err.code === '23503') {
      message = 'Référence invalide : enregistrement lié introuvable.';
      code = 'REFERENCE_INVALIDE';
    } else if (String(err.code).startsWith('23')) {
      message = 'Les données envoyées ne respectent pas les contraintes de la base.';
      code = 'DONNEES_INVALIDES';
    } else if (status >= 500) {
      message = 'Erreur lors de l’accès aux données.';
      code = 'ERREUR_BASE';
    }
  }

  res.status(status).json({ message, code });
});

async function ensureBaseRoles() {
  const db = getDb();
  const requiredRoles = ['client', 'vendeur', 'admin', 'livreur'];

  for (const roleName of requiredRoles) {
    const { data } = await db.from('roles').select('id').eq('nom', roleName).maybeSingle();
    if (!data) {
      await db.from('roles').insert({ nom: roleName });
    }
  }
}

async function startServer() {
  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGINS?.trim()) {
    console.warn(
      '[golivra] CORS_ORIGINS est vide : toutes les origines navigateur sont autorisées. Définissez CORS_ORIGINS (séparé par des virgules) pour une API web publique.',
    );
  }
  await ensureBaseRoles();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    const env = process.env.NODE_ENV || 'development';
    console.log(`API démarrée sur le port ${PORT} (NODE_ENV=${env})`);
  });
}

startServer().catch((error) => {
  console.error('Impossible de démarrer le serveur :', error.message);
  process.exit(1);
});
