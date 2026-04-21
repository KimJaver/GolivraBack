require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  }),
);

const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    const raw = process.env.CORS_ORIGINS;
    const isProd = process.env.NODE_ENV === 'production';
    if (!raw || !raw.trim()) {
      if (isProd) {
        return callback(null, false);
      }
      return callback(null, true);
    }
    const allowed = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '512kb' }));

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'GET' && req.path === '/health',
  message: { message: 'Trop de requêtes, réessayez plus tard.', code: 'RATE_LIMIT' },
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_OTP_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Trop de demandes OTP, réessayez plus tard.', code: 'RATE_LIMIT_OTP' },
});

app.use(generalLimiter);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'golivra-backend' });
});

app.use('/api/otp', otpLimiter, otpRoutes);
app.use('/api/auth', authRoutes);
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
      '[golivra] CORS_ORIGINS est vide : les navigateurs (requêtes avec en-tête Origin) seront refusés par CORS. Les apps sans Origin (souvent mobile) restent autorisées. Renseignez CORS_ORIGINS pour le web.',
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
