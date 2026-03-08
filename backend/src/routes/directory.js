/**
 * Directory routes:
 * GET /directory – list all farms and industries (read-only)
 */
const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  try {
    const [farms, industries] = await Promise.all([
      prisma.farm.findMany({
        select: {
          id: true,
          name: true,
          waste_type: true,
          quantity: true,
          desired_type: true,
          desired_quantity: true,
          latitude: true,
          longitude: true,
          description: true,
        },
      }),
      prisma.industry.findMany({
        select: {
          id: true,
          name: true,
          required_type: true,
          quantity_needed: true,
          byproduct_type: true,
          byproduct_quantity: true,
          latitude: true,
          longitude: true,
          description: true,
        },
      }),
    ]);
    return res.json({ farms, industries });
  } catch (err) {
    console.error('Directory error:', err);
    return res.status(500).json({ error: 'Failed to load directory' });
  }
});

module.exports = router;
