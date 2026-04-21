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
    return callback(new Error(`CORS blocked for origin: ${origin}`));
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
  const status = err.status || 500;
  res.status(status).json({
    message: err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
  });
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
  await ensureBaseRoles();
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Unable to start server:', error.message);
  process.exit(1);
});
