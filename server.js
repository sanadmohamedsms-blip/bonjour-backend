require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Bonjour Team API',
    time: new Date().toISOString(),
    env: {
      supabase: !!process.env.SUPABASE_URL,
      ai: !!process.env.AI_API_KEY
    }
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/store', require('./routes/store'));
app.use('/api/products', require('./routes/products'));
app.use('/api/planogram', require('./routes/planogram'));

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`\n🚀 Bonjour Team API running on http://localhost:${PORT}`);
    console.log(`📋 Health: http://localhost:${PORT}/health\n`);
  });
}

module.exports = app;
