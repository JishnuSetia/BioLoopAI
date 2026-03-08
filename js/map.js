/**
 * BioLoop AI – Map module.
 * Renders Leaflet map with farm and industry markers and connection lines.
 */

let map = null;
let overlays = null;
const routeCache = new Map();

function ensureMap(defaultCenter, defaultZoom) {
  if (!map) {
    map = window.L.map('map').setView(defaultCenter, defaultZoom);
    window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);
    overlays = window.L.layerGroup().addTo(map);
  } else {
    overlays?.clearLayers();
  }
  return map;
}

function fitMap(points, defaultCenter, defaultZoom) {
  if (points.length) {
    const bounds = window.L.latLngBounds(points);
    map.fitBounds(bounds.pad(0.2));
  } else {
    map.setView(defaultCenter, defaultZoom);
  }
}

function markerIcon(color, shape = 'circle') {
  const radius = shape === 'square' ? '3px' : '50%';
  return window.L.divIcon({
    className: 'marker-custom',
    html: `<span style="background:${color};width:12px;height:12px;border-radius:${radius};display:inline-block;border:2px solid #fff;"></span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

export function initMap(data) {
  const container = document.getElementById('map');
  if (!container || !window.L) return;

  const farms = data.farms || [];
  const industries = data.industries || [];
  const matches = data.matches || [];

  const defaultCenter = [56.1304, -106.3468]; // Canada centroid
  ensureMap(defaultCenter, 4);

  const points = [
    ...farms.map(f => [f.latitude, f.longitude]),
    ...industries.map(i => [i.latitude, i.longitude]),
  ].filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  fitMap(points, defaultCenter, 4);

  const farmIcon = markerIcon('#2d8f5f', 'circle');
  const industryIcon = markerIcon('#5cb88a', 'square');

  const farmById = {};
  farms.forEach(f => {
    farmById[f.id] = f;
    window.L.marker([f.latitude, f.longitude], { icon: farmIcon })
      .addTo(overlays)
      .bindPopup(`<strong>${f.name}</strong><br/>${f.waste_type}: ${f.quantity} tonnes/year`);
  });

  const industryById = {};
  industries.forEach(i => {
    industryById[i.id] = i;
    window.L.marker([i.latitude, i.longitude], { icon: industryIcon })
      .addTo(overlays)
      .bindPopup(`<strong>${i.name}</strong><br/>${i.required_type}: ${i.quantity_needed} tonnes/year`);
  });

  matches.forEach(m => {
    const farm = farmById[m.farm_id];
    const industry = industryById[m.industry_id];
    if (!farm || !industry) return;
    const latlngs = [
      [farm.latitude, farm.longitude],
      [industry.latitude, industry.longitude]
    ];
    window.L.polyline(latlngs, {
      color: 'rgba(45, 143, 95, 0.7)',
      weight: 2,
      dashArray: '5, 8'
    }).addTo(overlays);
  });
}

/**
 * Role-specific map:
 * - Green: current user's farm/industry
 * - Blue: active collaborations
 * - Grey: other suitable matches
 */
export function initRoleMap({ role, primary, collaborations = [], candidates = [], allFarms = [], allIndustries = [] }) {
  const container = document.getElementById('map');
  if (!container || !window.L) return;

  const defaultCenter = [56.1304, -106.3468];
  ensureMap(defaultCenter, 4);

  const points = [];
  const greenIcon = markerIcon('#2d8f5f', role === 'INDUSTRY_MANAGER' ? 'square' : 'circle');
  const blueIcon = markerIcon('#3d7edb', role === 'INDUSTRY_MANAGER' ? 'circle' : 'square');
  const greyIcon = markerIcon('#8fa99a', role === 'INDUSTRY_MANAGER' ? 'circle' : 'square');
  const lightGreyIcon = markerIcon('#5c6f66', role === 'INDUSTRY_MANAGER' ? 'circle' : 'square');
  const orangeIcon = markerIcon('#f0a44b', role === 'INDUSTRY_MANAGER' ? 'circle' : 'square');

  const skipFarmIds = new Set();
  const skipIndustryIds = new Set();

  if (primary?.id) {
    if (role === 'FARM_MANAGER') skipFarmIds.add(primary.id);
    if (role === 'INDUSTRY_MANAGER') skipIndustryIds.add(primary.id);
  }

  // Precompute collaboration targets to avoid duplicate markers
  collaborations.forEach((c) => {
    if (role === 'FARM_MANAGER' && c.industry?.id) skipIndustryIds.add(c.industry.id);
    if (role === 'INDUSTRY_MANAGER' && c.farm?.id) skipFarmIds.add(c.farm.id);
  });

  if (primary?.latitude != null && primary?.longitude != null) {
    points.push([primary.latitude, primary.longitude]);
    window.L.marker([primary.latitude, primary.longitude], { icon: greenIcon })
      .addTo(overlays)
      .bindPopup(`<strong>${primary.name}</strong><br/>${role === 'FARM_MANAGER' ? primary.waste_type : primary.required_type}`);
  }

  // Compatibility helper (kept in sync with optimizer aliases)
  function isCompatible(wasteType, requiredType) {
    const w = (wasteType || '').trim().toLowerCase();
    const r = (requiredType || '').trim().toLowerCase();
    if (w === r) return true;
    const aliases = {
      'manure': ['manure', 'biogas feedstock', 'organic fertilizer'],
      'crop residue': ['crop residue', 'crop_residue', 'biomass pellets', 'pellets'],
      'straw': ['straw', 'biogas feedstock', 'biomass pellets', 'pellets'],
    };
    for (const key of Object.keys(aliases)) {
      const vals = aliases[key];
      if ((w === key || vals.includes(w)) && (r === key || vals.includes(r))) return true;
    }
    return false;
  }

  const suitableFarmIds = new Set();
  const suitableIndustryIds = new Set();

  if (primary && role === 'FARM_MANAGER') {
    allIndustries.forEach((i) => {
      const supplyMatch = primary.waste_type && i.required_type
        ? isCompatible(primary.waste_type, i.required_type)
        : false;
      const demandMatch = primary.desired_type && i.byproduct_type
        ? isCompatible(i.byproduct_type, primary.desired_type)
        : false;
      if (supplyMatch || demandMatch) suitableIndustryIds.add(i.id);
    });
  }
  if (primary && role === 'INDUSTRY_MANAGER') {
    allFarms.forEach((f) => {
      const demandMatch = primary.required_type && f.waste_type
        ? isCompatible(f.waste_type, primary.required_type)
        : false;
      const supplyMatch = primary.byproduct_type && f.desired_type
        ? isCompatible(primary.byproduct_type, f.desired_type)
        : false;
      if (demandMatch || supplyMatch) suitableFarmIds.add(f.id);
    });
  }

  // Show all farms and industries. Suitable matches in grey, others in light grey.
  allFarms.forEach((f) => {
    if (skipFarmIds.has(f.id)) return;
    if (!Number.isFinite(f.latitude) || !Number.isFinite(f.longitude)) return;
    points.push([f.latitude, f.longitude]);
    const icon = suitableFarmIds.has(f.id) ? greyIcon : lightGreyIcon;
    window.L.marker([f.latitude, f.longitude], { icon })
      .addTo(overlays)
      .bindPopup(`<strong>${f.name}</strong><br/>${f.waste_type || 'Farm'}`);
  });

  allIndustries.forEach((i) => {
    if (skipIndustryIds.has(i.id)) return;
    if (!Number.isFinite(i.latitude) || !Number.isFinite(i.longitude)) return;
    points.push([i.latitude, i.longitude]);
    const icon = suitableIndustryIds.has(i.id) ? greyIcon : lightGreyIcon;
    window.L.marker([i.latitude, i.longitude], { icon })
      .addTo(overlays)
      .bindPopup(`<strong>${i.name}</strong><br/>${i.required_type || 'Industry'}`);
  });

  const collabPairs = new Set(
    collaborations.map((c) => `${c.farm_id}|${c.industry_id}`)
  );

  async function drawRoute(from, to, color, dashed = false) {
    if (!from || !to) return;
    const key = `${from[1]},${from[0]}|${to[1]},${to[0]}`;
    if (routeCache.has(key)) {
      const coords = routeCache.get(key);
      window.L.polyline(coords, {
        color,
        weight: 3,
        dashArray: dashed ? '6,8' : undefined,
      }).addTo(overlays);
      return;
    }
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('route failed');
      const data = await res.json();
      const coords = data?.routes?.[0]?.geometry?.coordinates;
      if (!coords) throw new Error('no route');
      const latLngs = coords.map(([lng, lat]) => [lat, lng]);
      routeCache.set(key, latLngs);
      window.L.polyline(latLngs, {
        color,
        weight: 3,
        dashArray: dashed ? '6,8' : undefined,
      }).addTo(overlays);
    } catch {
      // Fallback to straight line if routing fails
      window.L.polyline([from, to], {
        color,
        weight: 2,
        dashArray: dashed ? '6,8' : undefined,
      }).addTo(overlays);
    }
  }

  collaborations.forEach((c) => {
    const target = role === 'FARM_MANAGER' ? c.industry : c.farm;
    if (!target) return;
    points.push([target.latitude, target.longitude]);
    const isPending = c.status === 'PENDING';
    const isCompleted = c.status === 'COMPLETED';
    window.L.marker([target.latitude, target.longitude], { icon: isPending ? orangeIcon : blueIcon })
      .addTo(overlays)
      .bindPopup(`<strong>${target.name}</strong><br/>${
        isPending ? 'Pending invitation' : isCompleted ? 'Completed collaboration' : 'Active collaboration'
      }`);

    if (primary && target) {
      const routeColor = isPending
        ? 'rgba(240, 164, 75, 0.7)'
        : isCompleted
          ? 'rgba(45, 143, 95, 0.75)'
          : 'rgba(61, 126, 219, 0.7)';
      drawRoute(
        [primary.latitude, primary.longitude],
        [target.latitude, target.longitude],
        routeColor,
        isPending
      );
    }
  });

  // Candidates are already represented by compatibility highlighting above.

  fitMap(points, defaultCenter, 4);
}
