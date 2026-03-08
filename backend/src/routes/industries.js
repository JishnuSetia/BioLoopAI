/**
 * Industry routes: POST /industries (create), GET /industries (list), GET /industries/mine, PATCH /industries/mine (update).
 * All routes require JWT auth.
 */
const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Protect all industry endpoints
router.use(authMiddleware);

// Helper to check role for mutations
const requireIndustryRole = (req, res, next) => {
  if (req.user?.role !== 'INDUSTRY_MANAGER') {
    return res.status(403).json({ error: 'Industry manager access required' });
  }
  next();
};

/**
 * Validate and normalize industry input.
 * @param {object} body Request body
 * @param {boolean} partial Allow partial updates when true
 */
function parseIndustryInput(body, partial = false) {
  const data = {};

  const name = body?.name;
  const required_type = body?.required_type;
  const quantity_needed = body?.quantity_needed;
  const byproduct_type = body?.byproduct_type;
  const byproduct_quantity = body?.byproduct_quantity;
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

  if (!partial || required_type != null) {
    if (!required_type || !String(required_type).trim()) {
      throw new Error('required_type is required');
    }
    data.required_type = String(required_type).trim();
  }

  if (!partial || quantity_needed != null) {
    const qty = Number(quantity_needed);
    if (isNaN(qty) || qty < 0) {
      throw new Error('quantity_needed must be a non-negative number');
    }
    data.quantity_needed = qty;
  }

  if (!partial || byproduct_type != null) {
    if (byproduct_type == null || !String(byproduct_type).trim()) {
      data.byproduct_type = null;
    } else {
      data.byproduct_type = String(byproduct_type).trim();
    }
  }

  if (!partial || byproduct_quantity != null) {
    if (byproduct_quantity == null || byproduct_quantity === '' || isNaN(Number(byproduct_quantity))) {
      data.byproduct_quantity = null;
    } else {
      const qty = Number(byproduct_quantity);
      if (qty < 0) {
        throw new Error('byproduct_quantity must be a non-negative number');
      }
      data.byproduct_quantity = qty;
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

/** POST /industries – create an industry */
router.post('/', requireIndustryRole, async (req, res) => {
  try {
    const data = parseIndustryInput(req.body, false);
    const existing = await prisma.industry.findFirst({ where: { ownerId: req.user.id } });
    if (existing) {
      return res.status(409).json({ error: 'Industry already exists for this account' });
    }
    data.ownerId = req.user.id;
    const industry = await prisma.industry.create({ data });
    return res.status(201).json(industry);
  } catch (err) {
    const msg = err?.message || 'Failed to create industry';
    const code = msg.includes('required') || msg.includes('range') ? 400 : 500;
    console.error('Create industry error:', err);
    return res.status(code).json({ error: msg });
  }
});

/** GET /industries – list all industries */
router.get('/', async (req, res) => {
  try {
    const industries = await prisma.industry.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return res.json(industries);
  } catch (err) {
    console.error('List industries error:', err);
    return res.status(500).json({ error: 'Failed to list industries' });
  }
});

/** GET /industries/mine – fetch the current user's industry */
router.get('/mine', async (req, res) => {
  if (req.user?.role !== 'INDUSTRY_MANAGER') return res.status(404).json({ error: 'Not an industry manager' });
  try {
    const industry = await prisma.industry.findFirst({ where: { ownerId: req.user.id } });
    if (!industry) {
      return res.status(404).json({ error: 'Industry not found' });
    }
    return res.json(industry);
  } catch (err) {
    console.error('Fetch industry error:', err);
    return res.status(500).json({ error: 'Failed to fetch industry' });
  }
});

/** PATCH /industries/mine – update current user's industry */
router.patch('/mine', requireIndustryRole, async (req, res) => {
  try {
    const data = parseIndustryInput(req.body, true);
    const updated = await prisma.industry.updateMany({
      where: { ownerId: req.user.id },
      data,
    });
    if (updated.count === 0) {
      return res.status(404).json({ error: 'Industry not found' });
    }
    const industry = await prisma.industry.findFirst({ where: { ownerId: req.user.id } });
    return res.json(industry);
  } catch (err) {
    const msg = err?.message || 'Failed to update industry';
    const status = msg.includes('No valid fields') || msg.includes('required') || msg.includes('range')
      ? 400
      : err?.code === 'P2025'
        ? 404
        : 500;
    console.error('Update industry error:', err);
    return res.status(status).json({ error: msg });
  }
});

module.exports = router;
