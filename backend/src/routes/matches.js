/**
 * Matches route:
 * GET /matches/mine – JWT-protected, returns matches relevant to the current user.
 */
const express = require('express');
const prisma = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { runOptimize } = require('../services/optimizeService');

const router = express.Router();

// Pricing / sustainability defaults (keep aligned with optimizer.py)
const REVENUE_PER_TONNE = 80.0;
const COST_PER_KM_TONNE = 0.25;
const CO2_SAVED_PER_TONNE = 0.12;

function computeImpact(matches) {
  const totals = matches.reduce(
    (acc, m) => {
      acc.total_revenue += Number(m.revenue) || 0;
      acc.total_transport_cost += Number(m.transport_cost) || 0;
      acc.landfill_diverted += Number(m.quantity_matched) || 0;
      acc.co2_saved += Number(m.co2_saved) || 0;
      return acc;
    },
    { total_revenue: 0, total_transport_cost: 0, landfill_diverted: 0, co2_saved: 0 }
  );
  return {
    ...totals,
    net_value: totals.total_revenue - totals.total_transport_cost,
    match_count: matches.length,
  };
}

function isCompatible(wasteType, requiredType) {
  const w = String(wasteType || '').trim().toLowerCase();
  const r = String(requiredType || '').trim().toLowerCase();
  if (!w || !r) return false;
  if (w === r) return true;
  const aliases = {
    manure: ['manure', 'biogas feedstock', 'organic fertilizer'],
    'crop residue': ['crop residue', 'crop_residue', 'biomass pellets', 'pellets'],
    straw: ['straw', 'biogas feedstock', 'biomass pellets', 'pellets'],
  };
  for (const key of Object.keys(aliases)) {
    const vals = aliases[key];
    if ((w === key || vals.includes(w)) && (r === key || vals.includes(r))) return true;
  }
  return false;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function sustainabilityScore(co2Saved, distanceKm) {
  const raw = 0.5 + (co2Saved / 100) - (distanceKm / 500);
  return Math.max(0, Math.min(1, Number(raw.toFixed(2))));
}

function buildAllMatches(farms, industries) {
  const matches = [];

  farms.forEach((farm) => {
    industries.forEach((industry) => {
      // Flow A: farm supply -> industry demand
      if (
        farm.quantity > 0 &&
        industry.quantity_needed > 0 &&
        isCompatible(farm.waste_type, industry.required_type)
      ) {
        const quantity = Math.min(farm.quantity, industry.quantity_needed);
        const distance = haversineKm(farm.latitude, farm.longitude, industry.latitude, industry.longitude);
        const transport = Number((COST_PER_KM_TONNE * distance * quantity).toFixed(2));
        const revenue = Number((REVENUE_PER_TONNE * quantity).toFixed(2));
        const co2 = Number((CO2_SAVED_PER_TONNE * quantity).toFixed(2));
        matches.push({
          farm_id: farm.id,
          industry_id: industry.id,
          farm_name: farm.name,
          industry_name: industry.name,
          flow: 'FARM_TO_INDUSTRY',
          quantity_matched: Number(quantity.toFixed(2)),
          distance_km: Number(distance.toFixed(2)),
          transport_cost: transport,
          revenue,
          sustainability_score: sustainabilityScore(co2, distance),
          co2_saved: co2,
        });
      }

      // Flow B: industry byproduct -> farm demand
      if (
        industry.byproduct_quantity > 0 &&
        farm.desired_quantity > 0 &&
        isCompatible(industry.byproduct_type, farm.desired_type)
      ) {
        const quantity = Math.min(industry.byproduct_quantity, farm.desired_quantity);
        const distance = haversineKm(farm.latitude, farm.longitude, industry.latitude, industry.longitude);
        const transport = Number((COST_PER_KM_TONNE * distance * quantity).toFixed(2));
        const revenue = Number((REVENUE_PER_TONNE * quantity).toFixed(2));
        const co2 = Number((CO2_SAVED_PER_TONNE * quantity).toFixed(2));
        matches.push({
          farm_id: farm.id,
          industry_id: industry.id,
          farm_name: farm.name,
          industry_name: industry.name,
          flow: 'INDUSTRY_TO_FARM',
          quantity_matched: Number(quantity.toFixed(2)),
          distance_km: Number(distance.toFixed(2)),
          transport_cost: transport,
          revenue,
          sustainability_score: sustainabilityScore(co2, distance),
          co2_saved: co2,
        });
      }
    });
  });

  return matches;
}

function pickFarm(farm) {
  if (!farm) return null;
  return {
    id: farm.id,
    name: farm.name,
    waste_type: farm.waste_type,
    quantity: farm.quantity,
    desired_type: farm.desired_type,
    desired_quantity: farm.desired_quantity,
    latitude: Number(farm.latitude),
    longitude: Number(farm.longitude),
    description: farm.description || '',
  };
}

function pickIndustry(industry) {
  if (!industry) return null;
  return {
    id: industry.id,
    name: industry.name,
    required_type: industry.required_type,
    quantity_needed: industry.quantity_needed,
    byproduct_type: industry.byproduct_type,
    byproduct_quantity: industry.byproduct_quantity,
    latitude: Number(industry.latitude),
    longitude: Number(industry.longitude),
    description: industry.description || '',
  };
}

router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const farms = await prisma.farm.findMany();
    const industries = await prisma.industry.findMany();

    if (!farms.length || !industries.length) {
      return res.json({
        matches: [],
        impact_metrics: {
          total_revenue: 0,
          total_transport_cost: 0,
          co2_saved: 0,
          landfill_diverted: 0,
          net_value: 0,
          match_count: 0,
        },
        explanation: 'Add at least one farm and one industry to generate matches.',
        sustainability_summary: '',
        recommendations: [],
      });
    }

    const result = await runOptimize(farms, industries, { includeAi: true });
    const farmMap = new Map(farms.map((f) => [f.id, f]));
    const industryMap = new Map(industries.map((i) => [i.id, i]));

    let filtered = result.matches || [];
    if (req.user.role === 'FARM_MANAGER') {
      const myFarmIds = new Set(farms.filter((f) => f.ownerId === req.user.id).map((f) => f.id));
      if (myFarmIds.size === 0) {
        return res.json({
          matches: [],
          impact_metrics: computeImpact([]),
          explanation: 'Create your farm profile to see potential matches.',
          sustainability_summary: '',
          recommendations: [],
        });
      }
      filtered = filtered.filter((m) => myFarmIds.has(m.farm_id));
    } else if (req.user.role === 'INDUSTRY_MANAGER') {
      const myIndustryIds = new Set(industries.filter((i) => i.ownerId === req.user.id).map((i) => i.id));
      if (myIndustryIds.size === 0) {
        return res.json({
          matches: [],
          impact_metrics: computeImpact([]),
          explanation: 'Create your industry profile to see potential matches.',
          sustainability_summary: '',
          recommendations: [],
        });
      }
      filtered = filtered.filter((m) => myIndustryIds.has(m.industry_id));
    } else {
      filtered = [];
    }

    const enriched = filtered.map((m) => {
      const farm = pickFarm(farmMap.get(m.farm_id));
      const industry = pickIndustry(industryMap.get(m.industry_id));
      const counterparty = req.user.role === 'FARM_MANAGER' ? industry : farm;
      return {
        ...m,
        farm,
        industry,
        counterparty,
      };
    });

    return res.json({
      matches: enriched,
      impact_metrics: computeImpact(enriched),
      explanation: result.explanation,
      sustainability_summary: result.sustainability_summary,
      recommendations: result.recommendations,
      scenario: result.scenario,
    });
  } catch (err) {
    console.error('Matches error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate matches' });
  }
});

/**
 * GET /matches/all – compatible matches (not optimized), scoped to current user.
 */
router.get('/all', authMiddleware, async (req, res) => {
  try {
    const farms = await prisma.farm.findMany();
    const industries = await prisma.industry.findMany();

    if (!farms.length || !industries.length) {
      return res.json({ matches: [] });
    }

    const farmMap = new Map(farms.map((f) => [f.id, f]));
    const industryMap = new Map(industries.map((i) => [i.id, i]));

    let allMatches = buildAllMatches(farms, industries);

    if (req.user.role === 'FARM_MANAGER') {
      const myFarmIds = new Set(farms.filter((f) => f.ownerId === req.user.id).map((f) => f.id));
      if (myFarmIds.size === 0) {
        return res.json({ matches: [] });
      }
      allMatches = allMatches.filter((m) => myFarmIds.has(m.farm_id));
    } else if (req.user.role === 'INDUSTRY_MANAGER') {
      const myIndustryIds = new Set(industries.filter((i) => i.ownerId === req.user.id).map((i) => i.id));
      if (myIndustryIds.size === 0) {
        return res.json({ matches: [] });
      }
      allMatches = allMatches.filter((m) => myIndustryIds.has(m.industry_id));
    } else {
      allMatches = [];
    }

    const enriched = allMatches.map((m) => {
      const farm = pickFarm(farmMap.get(m.farm_id));
      const industry = pickIndustry(industryMap.get(m.industry_id));
      const counterparty = req.user.role === 'FARM_MANAGER' ? industry : farm;
      return {
        ...m,
        farm,
        industry,
        counterparty,
      };
    });

    return res.json({ matches: enriched });
  } catch (err) {
    console.error('All matches error:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate matches' });
  }
});

module.exports = router;
