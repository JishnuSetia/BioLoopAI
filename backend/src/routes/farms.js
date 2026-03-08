/**
 * Farm routes: POST /farms (create), GET /farms (list), GET /farms/mine, PATCH /farms/mine (update).
 * All routes require JWT auth.
 */
const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Protect all farm endpoints
router.use(authMiddleware);

// Helper to check role for mutations
const requireFarmRole = (req, res, next) => {
  if (req.user?.role !== 'FARM_MANAGER') {
    return res.status(403).json({ error: 'Farm manager access required' });
  }
  next();
};

/**
 * Validate and normalize farm input.
 * @param {object} body Request body
 * @param {boolean} partial Allow partial updates when true
 */
function parseFarmInput(body, partial = false) {
  const data = {};

  const name = body?.name;
  const waste_type = body?.waste_type;
  const quantity = body?.quantity;
  const desired_type = body?.desired_type;
  const desired_quantity = body?.desired_quantity;
  const isActive = body?.isActive;
  const latitude = body?.latitude;
  const longitude = body?.longitude;
  const description = body?.description;

  if (!partial || name != null) {
    if (!name || !String(name).trim()) {
      throw new Error('name is required');
    }
    data.name = String(name).trim();
  }

  if (!partial || waste_type != null) {
    if (!waste_type || !String(waste_type).trim()) {
      throw new Error('waste_type is required');
    }
    data.waste_type = String(waste_type).trim();
  }

  if (!partial || quantity != null) {
    const qty = Number(quantity);
    if (isNaN(qty) || qty < 0) {
      throw new Error('quantity must be a non-negative number');
    }
    data.quantity = qty;
  }

  if (!partial || desired_type != null) {
    if (desired_type == null || !String(desired_type).trim()) {
      data.desired_type = null;
    } else {
      data.desired_type = String(desired_type).trim();
    }
  }

  if (!partial || desired_quantity != null) {
    if (desired_quantity == null || desired_quantity === '' || isNaN(Number(desired_quantity))) {
      data.desired_quantity = null;
    } else {
      const qty = Number(desired_quantity);
      if (qty < 0) {
        throw new Error('desired_quantity must be a non-negative number');
      }
      data.desired_quantity = qty;
    }
  }

  if (isActive !== undefined) {
    const parsed = parseBoolean(isActive);
    if (parsed == null) {
      throw new Error('isActive must be a boolean');
    }
    data.isActive = parsed;
  }

  if (!partial || latitude != null || longitude != null) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (isNaN(lat) || isNaN(lng)) {
      throw new Error('latitude and longitude are required');
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error('latitude/longitude out of range');
    }
    data.latitude = lat;
    data.longitude = lng;
  }

  if (!partial || description != null) {
    if (description != null) {
      data.description = String(description).trim();
    }
  }

  if (partial && Object.keys(data).length === 0) {
    throw new Error('No valid fields provided');
  }

  return data;
}

function parseBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
  }
  return null;
}

/** POST /farms – create a farm */
router.post('/', requireFarmRole, async (req, res) => {
  try {
    const data = parseFarmInput(req.body, false);
    const existing = await prisma.farm.findFirst({ where: { ownerId: req.user.id } });
    if (existing) {
      return res.status(409).json({ error: 'Farm already exists for this account' });
    }
    data.ownerId = req.user.id;
    const farm = await prisma.farm.create({ data });
    return res.status(201).json(farm);
  } catch (err) {
    const msg = err?.message || 'Failed to create farm';
    const code = msg.includes('required') || msg.includes('range') ? 400 : 500;
    console.error('Create farm error:', err);
    return res.status(code).json({ error: msg });
  }
});

/** GET /farms – list all farms */
router.get('/', async (req, res) => {
  try {
    const farms = await prisma.farm.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return res.json(farms);
  } catch (err) {
    console.error('List farms error:', err);
    return res.status(500).json({ error: 'Failed to list farms' });
  }
});

/** GET /farms/mine – fetch the current user's farm */
router.get('/mine', async (req, res) => {
  if (req.user?.role !== 'FARM_MANAGER') return res.status(404).json({ error: 'Not a farm manager' });
  try {
    const farm = await prisma.farm.findFirst({ where: { ownerId: req.user.id } });
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    return res.json(farm);
  } catch (err) {
    console.error('Fetch farm error:', err);
    return res.status(500).json({ error: 'Failed to fetch farm' });
  }
});

/** PATCH /farms/mine – update current user's farm */
router.patch('/mine', requireFarmRole, async (req, res) => {
  try {
    const data = parseFarmInput(req.body, true);
    const updated = await prisma.farm.updateMany({
      where: { ownerId: req.user.id },
      data,
    });
    if (updated.count === 0) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    const farm = await prisma.farm.findFirst({ where: { ownerId: req.user.id } });
    return res.json(farm);
  } catch (err) {
    const msg = err?.message || 'Failed to update farm';
    const status = msg.includes('No valid fields') || msg.includes('required') || msg.includes('range')
      ? 400
      : err?.code === 'P2025'
        ? 404
        : 500;
    console.error('Update farm error:', err);
    return res.status(status).json({ error: msg });
  }
});

module.exports = router;
