/**
 * Runs Python optimizer and AI explainer via child_process.
 * Expects Python env with: pip install -r backend/python/requirements.txt
 * and Ollama running for AI (optional; explainer returns fallback text if Ollama unavailable).
 */
const { runPython } = require('./pythonRunner');

/**
 * Run optimization (PuLP) then AI explainer (Ollama).
 * @param {Array} farms - from DB: id, name, waste_type, quantity, latitude, longitude
 * @param {Array} industries - from DB: id, name, required_type, quantity_needed, latitude, longitude
 * @param {object} options - { simulation?: object, includeAi?: boolean }
 * @returns {Promise<{ matches, impact_metrics, explanation, sustainability_summary, recommendations, scenario }>}
 */
async function runOptimize(farms, industries, options = {}) {
  const simulation = options?.simulation || null;
  const farmsPayload = farms.map((f) => ({
    id: f.id,
    name: f.name,
    waste_type: f.waste_type,
    quantity: f.quantity,
    desired_type: f.desired_type,
    desired_quantity: f.desired_quantity,
    latitude: f.latitude,
    longitude: f.longitude,
    isActive: f.isActive !== false, // default true if not set
  }));
  const industriesPayload = industries.map((i) => ({
    id: i.id,
    name: i.name,
    required_type: i.required_type,
    quantity_needed: i.quantity_needed,
    byproduct_type: i.byproduct_type,
    byproduct_quantity: i.byproduct_quantity,
    latitude: i.latitude,
    longitude: i.longitude,
    isActive: i.isActive !== false, // default true if not set
  }));

  const optResult = await runPython('optimizer.py', {
    farms: farmsPayload,
    industries: industriesPayload,
    simulation,
  });

  if (optResult.error) {
    throw new Error(optResult.error);
  }

  const {
    matches = [],
    total_revenue = 0,
    total_transport_cost = 0,
    co2_saved = 0,
    landfill_diverted = 0,
    scenario = simulation || {},
  } = optResult;
  const net_value = Number(total_revenue) - Number(total_transport_cost);
  const impact_metrics = {
    total_revenue,
    total_transport_cost,
    co2_saved,
    landfill_diverted,
    net_value,
    match_count: matches.length,
  };

  let explanation = '';
  let sustainability_summary = '';
  let recommendations = [];

  if (options.includeAi !== false) {
    try {
      const aiResult = await runPython('ai_explainer.py', {
        matches,
        total_revenue,
        total_transport_cost,
        co2_saved,
        landfill_diverted,
        scenario,
      });
      explanation = aiResult.explanation || aiResult.raw_response || '';
      sustainability_summary = aiResult.sustainability_summary || '';
      recommendations = Array.isArray(aiResult.recommendations) ? aiResult.recommendations : [];
    } catch (err) {
      console.warn('AI explainer failed (Ollama may be down):', err.message);
      explanation = 'AI explanation unavailable. Start Ollama (ollama run llama3.2) for human-readable insights.';
      sustainability_summary = `Optimization completed: ${total_revenue} CAD revenue, ${co2_saved} tCO2e saved, ${landfill_diverted} tonnes diverted from landfill.`;
      recommendations = [
        'Add more farm supply and industry demand to improve match coverage.',
        'Reduce transport cost by preferring closer farm–industry pairs.',
        'Review biomass type compatibility to unlock additional matches.',
      ];
    }
  } else {
    explanation = 'AI explanation skipped for this simulation run.';
    sustainability_summary = `Optimization completed: ${total_revenue} CAD revenue, ${co2_saved} tCO2e saved, ${landfill_diverted} tonnes diverted from landfill.`;
  }

  return {
    matches,
    impact_metrics,
    explanation,
    sustainability_summary,
    recommendations,
    scenario,
  };
}

module.exports = { runOptimize };
