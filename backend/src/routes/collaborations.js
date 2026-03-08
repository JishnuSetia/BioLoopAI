/**
 * Collaboration routes:
 * GET /collaborations/mine – list collaborations for current user.
 * POST /collaborations – create or activate a collaboration.
 * PATCH /collaborations/:id – update collaboration status/notes.
 */
const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const STATUS_VALUES = new Set(['PENDING', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']);
const FLOW_VALUES = new Set(['FARM_TO_INDUSTRY', 'INDUSTRY_TO_FARM']);

function normalizeStatus(value) {
  const v = String(value || '').toUpperCase();
  return STATUS_VALUES.has(v) ? v : null;
}

function normalizeFlow(value) {
  const v = String(value || '').toUpperCase();
  return FLOW_VALUES.has(v) ? v : 'FARM_TO_INDUSTRY';
}

router.use(authMiddleware);

/** GET /collaborations/mine */
router.get('/mine', async (req, res) => {
  try {
    let where = {};
    if (req.user.role === 'FARM_MANAGER') {
      where = { farm: { ownerId: req.user.id } };
    } else if (req.user.role === 'INDUSTRY_MANAGER') {
      where = { industry: { ownerId: req.user.id } };
    } else {
      return res.json([]);
    }

    const collaborations = await prisma.collaboration.findMany({
      where,
      include: { farm: true, industry: true },
      orderBy: { updatedAt: 'desc' },
    });
    return res.json(collaborations);
  } catch (err) {
    console.error('List collaborations error:', err);
    return res.status(500).json({ error: 'Failed to list collaborations' });
  }
});

/** POST /collaborations – create or re-activate */
router.post('/', async (req, res) => {
  try {
    const { farm_id, industry_id, status, notes, flow } = req.body || {};
    if (!farm_id || !industry_id) {
      return res.status(400).json({ error: 'farm_id and industry_id are required' });
    }

    const farm = await prisma.farm.findUnique({ where: { id: farm_id } });
    const industry = await prisma.industry.findUnique({ where: { id: industry_id } });
    if (!farm || !industry) {
      return res.status(404).json({ error: 'Farm or industry not found' });
    }

    // Ownership check: users can only initiate a collaboration FROM their own entity.
    // They can collaborate WITH anyone on the other side.
    if (req.user.role === 'FARM_MANAGER') {
      const myFarm = await prisma.farm.findFirst({ where: { ownerId: req.user.id } });
      if (!myFarm || myFarm.id !== farm_id) {
        return res.status(403).json({ error: 'You can only collaborate from your own farm' });
      }
    }
    if (req.user.role === 'INDUSTRY_MANAGER') {
      const myIndustry = await prisma.industry.findFirst({ where: { ownerId: req.user.id } });
      if (!myIndustry || myIndustry.id !== industry_id) {
        return res.status(403).json({ error: 'You can only collaborate from your own industry' });
      }
    }

    const normalizedStatus = normalizeStatus(status) || 'PENDING';
    const normalizedFlow = normalizeFlow(flow);
    const latest = await prisma.collaboration.findFirst({
      where: { farm_id, industry_id, flow: normalizedFlow },
      orderBy: { createdAt: 'desc' },
    });

    if (latest && !['COMPLETED', 'CANCELLED'].includes(latest.status)) {
      const updated = await prisma.collaboration.update({
        where: { id: latest.id },
        data: {
          status: normalizedStatus,
          notes: notes ? String(notes).trim() : latest.notes,
          requestedById: req.user.id,
          requestedByRole: req.user.role,
          respondedAt: null,
          flow: normalizedFlow,
        },
        include: { farm: true, industry: true },
      });
      return res.json(updated);
    }

    const created = await prisma.collaboration.create({
      data: {
        farm_id,
        industry_id,
        flow: normalizedFlow,
        status: normalizedStatus,
        notes: notes ? String(notes).trim() : null,
        requestedById: req.user.id,
        requestedByRole: req.user.role,
      },
      include: { farm: true, industry: true },
    });
    return res.status(201).json(created);
  } catch (err) {
    console.error('Create collaboration error:', err);
    return res.status(500).json({ error: 'Failed to create collaboration' });
  }
});

/** PATCH /collaborations/:id – update status/notes */
router.patch('/:id', async (req, res) => {
  try {
    const status = normalizeStatus(req.body?.status);
    const notes = req.body?.notes;
    if (!status && notes == null) {
      return res.status(400).json({ error: 'Provide status or notes to update' });
    }

    const collaboration = await prisma.collaboration.findUnique({
      where: { id: req.params.id },
      include: { farm: true, industry: true },
    });
    if (!collaboration) {
      return res.status(404).json({ error: 'Collaboration not found' });
    }

    if (req.user.role === 'FARM_MANAGER' && collaboration.farm.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (req.user.role === 'INDUSTRY_MANAGER' && collaboration.industry.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    // If accepting, only the counterparty can accept a PENDING request
    if (status === 'ACTIVE' && collaboration.status === 'PENDING') {
      const requester = collaboration.requestedById;
      if (requester && requester === req.user.id) {
        return res.status(403).json({ error: 'The other party must accept this invitation' });
      }
    }

    const updated = await prisma.collaboration.update({
      where: { id: collaboration.id },
      data: {
        ...(status ? { status } : {}),
        ...(notes != null ? { notes: String(notes).trim() } : {}),
        ...(status ? { respondedAt: new Date() } : {}),
      },
      include: { farm: true, industry: true },
    });
    return res.json(updated);
  } catch (err) {
    console.error('Update collaboration error:', err);
    return res.status(500).json({ error: 'Failed to update collaboration' });
  }
});

module.exports = router;
