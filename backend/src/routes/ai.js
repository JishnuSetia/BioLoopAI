/**
 * AI routes:
 * POST /ai/match-review - Returns an AI recommendation for a single match.
 */
const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { runPython } = require('../services/pythonRunner');

const router = express.Router();

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Simple fallback when Ollama is unavailable.
function heuristicReview(match) {
  const revenue = toNumber(match.revenue);
  const transport = toNumber(match.transport_cost);
  const distance = toNumber(match.distance_km);
  const co2 = toNumber(match.co2_saved);
  const sustainability = toNumber(match.sustainability_score);
  const netValue = revenue - transport;

  let score = 0;
  if (netValue > 3000) score += 2;
  else if (netValue > 0) score += 1;
  else score -= 1;

  if (distance < 80) score += 1;
  else if (distance > 200) score -= 1;

  if (sustainability >= 0.6) score += 1;
  else if (sustainability < 0.4) score -= 1;

  if (co2 > 5) score += 1;

  const decision = score >= 3 ? 'ACCEPT' : score >= 1 ? 'CONSIDER' : 'DECLINE';
  const confidence = Math.min(0.9, Math.max(0.45, 0.55 + score * 0.1));
  return {
    decision,
    confidence: Number(confidence.toFixed(2)),
    summary: `${decision[0]}${decision.slice(1).toLowerCase()} based on net value, distance, and sustainability impact.`,
    key_factors: [
      `Net value: ${netValue.toFixed(0)} CAD`,
      `Distance: ${distance.toFixed(0)} km`,
      `CO₂ saved: ${co2.toFixed(2)} tCO₂e`,
    ],
    risks: [
      netValue <= 0 ? 'Negative net value after transport cost.' : 'No major red flags detected based on current data.',
    ],
    improvements: [
      'Negotiate transport cost sharing or closer pickup points.',
      'Confirm biomass quality and consistency before contracting.',
      'Lock in volumes to improve revenue certainty.',
    ],
  };
}

router.post('/match-review', authMiddleware, async (req, res) => {
  try {
    const { match, farm, industry } = req.body || {};
    if (!match) {
      return res.status(400).json({ error: 'Match payload required' });
    }

    const [farmRecord, industryRecord] = await Promise.all([
      match.farm_id ? prisma.farm.findUnique({ where: { id: match.farm_id } }) : null,
      match.industry_id ? prisma.industry.findUnique({ where: { id: match.industry_id } }) : null,
    ]);

    if (req.user.role === 'FARM_MANAGER' && farmRecord && farmRecord.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to review this match' });
    }
    if (req.user.role === 'INDUSTRY_MANAGER' && industryRecord && industryRecord.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to review this match' });
    }

    const payload = {
      match,
      farm: farm || farmRecord || {},
      industry: industry || industryRecord || {},
    };

    let review = null;
    try {
      review = await runPython('ai_match_review.py', payload);
    } catch (err) {
      review = null;
    }

    if (!review || !review.decision) {
      review = heuristicReview(match);
    }

    return res.json(review);
  } catch (err) {
    console.error('AI match review error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate AI review' });
  }
});

module.exports = router;
