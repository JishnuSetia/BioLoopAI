/**
 * Optimize routes:
 * GET /optimize – JWT-protected, runs base optimization and persists matches.
 * POST /optimize – JWT-protected, runs simulation (no persistence by default).
 */
const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { runOptimize } = require('../services/optimizeService');

const router = express.Router();

/**
 * Persist matches as the latest recommended set.
 * Clears existing matches to avoid stale records.
 */
async function persistMatches(matches) {
  await prisma.match.deleteMany({});
  if (!matches || matches.length === 0) return;
  await prisma.match.createMany({
    data: matches.map((m) => ({
      farm_id: m.farm_id,
      industry_id: m.industry_id,
      flow: m.flow || 'FARM_TO_INDUSTRY',
      quantity_matched: m.quantity_matched,
      distance_km: m.distance_km,
      transport_cost: m.transport_cost,
      revenue: m.revenue,
      sustainability_score: m.sustainability_score,
    })),
    skipDuplicates: true,
  });
}

/**
 * Build optimization result for current DB state.
 * @param {object} options { simulation?: object, includeAi?: boolean }
 */
async function optimizeFromDb(options = {}) {
  const farms = await prisma.farm.findMany();
  const industries = await prisma.industry.findMany();

  if (farms.length === 0 || industries.length === 0) {
    const err = new Error(
      'At least one farm and one industry required. Add data via POST /farms and POST /industries.'
    );
    err.status = 400;
    throw err;
  }

  return runOptimize(farms, industries, options);
}

/** GET /optimize – base optimization and persistence */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await optimizeFromDb({ includeAi: true });
    await persistMatches(result.matches);
    return res.json(result);
  } catch (err) {
    console.error('Optimize error:', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Optimization failed',
    });
  }
});

/** POST /optimize – simulation run (no persistence by default) */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const simulation = req.body?.simulation || {};
    const includeAi = req.body?.include_ai !== false;
    const persist = req.body?.persist === true;

    const result = await optimizeFromDb({ simulation, includeAi });
    if (persist) {
      await persistMatches(result.matches);
    }
    return res.json(result);
  } catch (err) {
    console.error('Optimize (simulation) error:', err);
    return res.status(err.status || 500).json({
      error: err.message || 'Optimization failed',
    });
  }
});

module.exports = router;
