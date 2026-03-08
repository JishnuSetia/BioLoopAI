/**
 * BioLoop AI – Express API server.
 * Auth (signup, login, /me), farms, industries, GET /optimize (PuLP + Ollama).
 */
const express = require('express');
const cors = require('cors');
const config = require('./config');

const authRoutes = require('./routes/auth');
const farmsRoutes = require('./routes/farms');
const industriesRoutes = require('./routes/industries');
const optimizeRoutes = require('./routes/optimize');
const matchesRoutes = require('./routes/matches');
const collaborationsRoutes = require('./routes/collaborations');
const directoryRoutes = require('./routes/directory');
const aiRoutes = require('./routes/ai');

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json());

app.use('/auth', authRoutes);
app.use('/farms', farmsRoutes);
app.use('/industries', industriesRoutes);
app.use('/optimize', optimizeRoutes);
app.use('/matches', matchesRoutes);
app.use('/collaborations', collaborationsRoutes);
app.use('/directory', directoryRoutes);
app.use('/ai', aiRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'bioloop-ai-api' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(config.port, () => {
  console.log(`BioLoop AI API listening on http://localhost:${config.port}`);
});
