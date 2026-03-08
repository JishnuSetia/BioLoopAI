/**
 * BioLoop AI – Charts module (Chart.js).
 * Biomass by type (doughnut) and Revenue by industry (bar).
 */

const CHART_COLORS = {
  green: 'rgba(45, 143, 95, 0.9)',
  greenLight: 'rgba(92, 184, 138, 0.9)',
  greenMuted: 'rgba(45, 143, 95, 0.5)',
  grid: 'rgba(143, 169, 154, 0.15)',
  text: '#e8f0ec',
  textMuted: '#8fa99a'
};

function getChartOptions(plugins = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: CHART_COLORS.textMuted, font: { size: 11 } }
      },
      ...plugins
    }
  };
}

let biomassChart = null;
let revenueChart = null;

function groupSum(items, keyFn, valueFn) {
  const m = new Map();
  for (const it of items) {
    const k = keyFn(it);
    const v = Number(valueFn(it) ?? 0);
    m.set(k, (m.get(k) || 0) + (isNaN(v) ? 0 : v));
  }
  return m;
}

export function initCharts(data) {
  if (!window.Chart) return;

  const farms = data.farms || [];
  const matches = data.matches || [];

  const biomassMap = groupSum(
    farms,
    (f) => (f.waste_type || 'unknown').toLowerCase(),
    (f) => f.quantity
  );
  const biomassByType = {
    labels: Array.from(biomassMap.keys()).map((k) => k.replaceAll('_', ' ')),
    values: Array.from(biomassMap.values()),
  };

  const revenueMap = groupSum(
    matches,
    (m) => m.industry_name || 'Industry',
    (m) => m.revenue
  );
  const revenueByIndustry = {
    labels: Array.from(revenueMap.keys()),
    values: Array.from(revenueMap.values()),
  };

  const biomassCtx = document.getElementById('chart-biomass')?.getContext('2d');
  if (biomassCtx && biomassByType) {
    biomassChart?.destroy();
    biomassChart = new window.Chart(biomassCtx, {
      type: 'doughnut',
      data: {
        labels: biomassByType.labels,
        datasets: [{
          data: biomassByType.values,
          backgroundColor: [CHART_COLORS.green, CHART_COLORS.greenLight, CHART_COLORS.greenMuted],
          borderColor: '#111a16',
          borderWidth: 2
        }]
      },
      options: getChartOptions()
    });
  }

  const revenueCtx = document.getElementById('chart-revenue')?.getContext('2d');
  if (revenueCtx && revenueByIndustry) {
    revenueChart?.destroy();
    revenueChart = new window.Chart(revenueCtx, {
      type: 'bar',
      data: {
        labels: revenueByIndustry.labels,
        datasets: [{
          label: 'Revenue (CAD)',
          data: revenueByIndustry.values,
          backgroundColor: 'rgba(45, 143, 95, 0.35)',
          borderColor: CHART_COLORS.green,
          borderWidth: 1
        }]
      },
      options: {
        ...getChartOptions(),
        scales: {
          x: {
            grid: { color: CHART_COLORS.grid },
            ticks: { color: CHART_COLORS.textMuted, maxRotation: 0 }
          },
          y: {
            grid: { color: CHART_COLORS.grid },
            ticks: { color: CHART_COLORS.textMuted }
          }
        }
      }
    });
  }
}
