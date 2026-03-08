/**
 * BioLoop AI – Unified Dashboard.
 * Role-adaptive logic for both Farm and Industry managers.
 */

import { requireAuth, setStoredJwt, redirectByRole } from './auth.js';
import { apiFetch } from './api.js';
import { initMap, initRoleMap } from './map.js';
import { initCharts } from './charts.js';
import { initAiInsights } from './ai-insights.js';

if (!requireAuth()) {
  throw new Error('Auth required');
}

let state = {
  me: null,
  profile: null, // Farm or Industry
  directory: { farms: [], industries: [] },
  collaborations: [],
  contractTab: 'ACTIVE',
  optimize: null,
};

const DEFAULT_COORDS = { lat: 50.4452, lng: -104.6189 }; // Regina, SK

/** Helper: Formatting */
function formatNumber(n) {
  const value = Number(n) || 0;
  return new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 }).format(value);
}

function formatCurrency(n) {
  const value = Number(n) || 0;
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(value);
}

function escapeHtml(str) {
  return String(str || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

/** UI: Impact Cards */
function renderImpactCards(optimizeResult) {
  const grid = document.getElementById('impact-cards');
  if (!grid || !optimizeResult?.impact_metrics) return;

  const s = optimizeResult.impact_metrics;
  grid.innerHTML = `
    <div class="impact-card">
      <div class="label">Matches</div>
      <div class="value">${formatNumber(s.match_count)} <span class="unit">pairs</span></div>
    </div>
    <div class="impact-card">
      <div class="label">Biomass diverted</div>
      <div class="value">${formatNumber(s.landfill_diverted)} <span class="unit">tonnes</span></div>
    </div>
    <div class="impact-card">
      <div class="label">Revenue</div>
      <div class="value">${formatCurrency(s.total_revenue)}</div>
    </div>
    <div class="impact-card">
      <div class="label">Transport cost</div>
      <div class="value">${formatCurrency(s.total_transport_cost)}</div>
    </div>
    <div class="impact-card">
      <div class="label">Net value</div>
      <div class="value">${formatCurrency(s.net_value)}</div>
    </div>
    <div class="impact-card">
      <div class="label">CO₂ saved</div>
      <div class="value">${formatNumber(s.co2_saved)} <span class="unit">tCO₂e</span></div>
    </div>
  `;
}

/** UI: Listings */
function renderListings() {
  const container = document.getElementById('listing-cards');
  if (!container || !state.profile) return;

  const isFarm = state.me?.role === 'FARM_MANAGER';
  const item1Label = isFarm ? 'We offer' : 'We need';
  const item1Type = isFarm ? state.profile.waste_type : state.profile.required_type;
  const item1Qty = isFarm ? state.profile.quantity : state.profile.quantity_needed;

  const item2Label = isFarm ? 'We need' : 'We offer';
  const item2Type = isFarm ? state.profile.desired_type : state.profile.byproduct_type;
  const item2Qty = isFarm ? state.profile.desired_quantity : state.profile.byproduct_quantity;

  container.innerHTML = `
    <div class="listing-card">
      <h3>${item1Label}</h3>
      <div class="listing-meta">${escapeHtml(item1Type || 'Not listed')} · ${item1Qty ? formatNumber(item1Qty) : '0'} tonnes/year</div>
    </div>
    <div class="listing-card">
      <h3>${item2Label}</h3>
      <div class="listing-meta">${escapeHtml(item2Type || 'Not listed')} · ${item2Qty ? formatNumber(item2Qty) : '0'} tonnes/year</div>
    </div>
  `;
}

/** UI: Matches Table */
function renderMatchesTable(optimizeResult) {
  const thead = document.getElementById('matches-thead');
  const tbody = document.getElementById('matches-tbody');
  if (!thead || !tbody) return;

  const isFarm = state.me?.role === 'FARM_MANAGER';
  const counterpartyLabel = isFarm ? 'Industry' : 'Farm';

  thead.innerHTML = `
    <th>${counterpartyLabel}</th>
    <th>Flow</th>
    <th>Material</th>
    <th>Quantity</th>
    <th>Revenue</th>
    <th>Distance</th>
    <th>CO₂ saved</th>
    <th>Details</th>
  `;

  const allMatches = optimizeResult?.matches || [];

  // Build a set of node pairs that already have an active (non-cancelled, non-completed) collaboration.
  // Key format: "smallerId|largerId" for order-independent lookup.
  const proposedPairs = new Set(
    (state.collaborations || [])
      .filter(c => !['CANCELLED', 'COMPLETED'].includes(c.status))
      .map(c => [c.farm_id, c.industry_id].sort().join('|'))
  );

  const hasProposal = (m) => {
    // Check any combination of the two node IDs in the match
    return proposedPairs.has([m.src_id, m.dst_id].sort().join('|'));
  };

  // Filter matches: exclude ones already proposed
  const activeMatches = allMatches.filter(m => !hasProposal(m));

  const categorize = (list) => {
    return {
      supply: list.filter(m => String(m.src_id) === String(state.profile?.id)),
      receive: list.filter(m => String(m.dst_id) === String(state.profile?.id))
    };
  };

  const myMatches = categorize(activeMatches.filter(m => String(m.src_id) === String(state.profile?.id) || String(m.dst_id) === String(state.profile?.id)));

  // Potential matches: Everything else. 
  const globalMatches = {
    supply: activeMatches.filter(m => String(m.src_id) !== String(state.profile?.id) && String(m.dst_id) !== String(state.profile?.id)),
    receive: [] // We'll put everything in supply or split them
  };

  const renderRow = (m, listIdx, group, sub) => {
    // Counterparty is the one that's NOT the user in myMatches, 
    // or the 'other' side in global matches.
    let cpName = "";
    if (group === 'my') {
      cpName = m.src_id === state.profile?.id ? m.dst_name : m.src_name;
    } else {
      cpName = sub === 'supply' ? m.dst_name : m.src_name;
    }

    const flowLabel = (sub === 'supply') ? 'Supply' : 'Receive';

    // Find material type from the source node
    let material = 'Biomass';
    if (m.src_type === 'FARM') {
      material = state.directory.farms.find(f => f.id === m.src_id)?.waste_type || 'Biomass';
    } else {
      material = state.directory.industries.find(i => i.id === m.src_id)?.byproduct_type || 'Byproduct';
    }

    return `
      <tr class="${group === 'my' ? 'row-suggested' : 'row-global'}">
        <td><strong>${escapeHtml(cpName)}</strong></td>
        <td>${flowLabel}</td>
        <td>${escapeHtml(material)}</td>
        <td>${formatNumber(m.quantity_matched)} t</td>
        <td>${formatCurrency(m.revenue)}</td>
        <td>${m.distance_km} km</td>
        <td>${formatNumber(m.co2_saved)} tCO₂e</td>
        <td><button class="btn btn-secondary btn-small" data-idx="${listIdx}" data-group="${group}" data-sub="${sub}">View</button></td>
      </tr>
    `;
  };

  const renderGroup = (cat, groupLabel, groupId) => {
    let groupHtml = '';
    if (cat.supply.length > 0 || cat.receive.length > 0) {
      groupHtml += `<tr class="table-group-header"><td colspan="8">${groupLabel}</td></tr>`;

      if (cat.supply.length > 0) {
        const subLabel = groupId === 'my' ? '↑ Outbound (Your Supply)' : 'System Transactions';
        groupHtml += `<tr class="table-subgroup-header"><td colspan="8">${subLabel}</td></tr>`;
        groupHtml += cat.supply.map((m, i) => renderRow(m, i, groupId, 'supply')).join('');
      }

      if (cat.receive.length > 0) {
        const subLabel = groupId === 'my' ? '↓ Inbound (Your Demand)' : '';
        if (subLabel) groupHtml += `<tr class="table-subgroup-header"><td colspan="8">${subLabel}</td></tr>`;
        groupHtml += cat.receive.map((m, i) => renderRow(m, i, groupId, 'receive')).join('');
      }
    }
    return groupHtml;
  };

  if (!allMatches.length) {
    tbody.innerHTML = `<tr><td class="table-empty" colspan="8">No matches found in the system.</td></tr>`;
    return;
  }

  let html = renderGroup(myMatches, 'Suggested for You', 'my');
  html += renderGroup(globalMatches, 'All Potential Matches', 'global');

  if (!html) {
    tbody.innerHTML = `<tr><td class="table-empty" colspan="8">No relevant matches found for your profile.</td></tr>`;
    return;
  }

  tbody.innerHTML = html;

  tbody.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { idx, group, sub } = btn.dataset;
      const match = group === 'my' ? myMatches[sub][idx] : globalMatches[sub][idx];

      const cpId = match.src_id === state.profile?.id ? match.dst_id : match.src_id;
      const cpType = match.src_id === state.profile?.id ? match.dst_type : match.src_type;

      const cp = cpType === 'FARM'
        ? state.directory.farms.find(f => f.id === cpId)
        : state.directory.industries.find(i => i.id === cpId);

      const confidence = (match.sustainability_score * 100).toFixed(0);
      const suggestion = match.sustainability_score > 0.7
        ? "Highly Recommended: Strategic profile alignment. Propose collaboration now."
        : match.sustainability_score > 0.4
          ? "Good Opportunity: Moderate transport efficiency. Worth investigating."
          : "Limited Synergy: High distance or low material match.";

      openDetailModal(cp?.name || 'Details', `
          <div class="detail-row"><strong>Type:</strong> ${isFarm ? 'Industry' : 'Farm'}</div>
          <div class="detail-row"><strong>Description:</strong> ${escapeHtml(cp?.description || 'No description.')}</div>
          <div class="detail-row"><strong>Match Flow:</strong> ${match.flow}</div>
          <div class="ai-confidence-box">
             <div class="confidence-label">AI Match Confidence: <strong>${confidence}%</strong></div>
             <div class="confidence-bar"><div class="fill" style="width:${confidence}%"></div></div>
             <div class="suggestion-text">${suggestion}</div>
          </div>
          <div class="modal-footer" style="margin-top:2rem; display:flex; justify-content:flex-end">
            <button class="btn btn-primary btn-invite" 
              data-flow="${match.flow}" 
              data-src-id="${match.src_id}" 
              data-dst-id="${match.dst_id}"
              data-src-type="${match.src_type}"
              data-dst-type="${match.dst_type}"
            >Propose Collaboration</button>
          </div>
        `);
    });
  });
}

/** UI: Contracts Table */
function renderContractsTable() {
  const thead = document.getElementById('contracts-thead');
  const tbody = document.getElementById('contracts-tbody');
  if (!thead || !tbody) return;

  const isFarm = state.me?.role === 'FARM_MANAGER';
  const counterpartyLabel = isFarm ? 'Industry' : 'Farm';

  thead.innerHTML = `
    <th>${counterpartyLabel}</th>
    <th>Status</th>
    <th>Material Flow</th>
    <th>Started</th>
    <th>Action</th>
  `;

  const all = state.collaborations || [];

  const active = all.filter(c => c.status === 'ACTIVE');
  const pending = all.filter(c => c.status === 'PENDING');
  const completed = all.filter(c => ['COMPLETED', 'CANCELLED'].includes(c.status));

  const renderCollabRow = (c) => {
    const cp = isFarm ? c.industry : c.farm;
    return `
      <tr>
        <td><strong>${escapeHtml(cp?.name || 'Unknown')}</strong></td>
        <td><span class="status-pill status-${c.status.toLowerCase()}">${c.status}</span></td>
        <td>${c.flow === 'FARM_TO_INDUSTRY' ? 'Farm → Industry' : 'Industry → Farm'}</td>
        <td>${new Date(c.createdAt).toLocaleDateString()}</td>
        <td><button class="btn btn-secondary btn-small btn-view-collab" data-id="${c.id}">Manage</button></td>
      </tr>
    `;
  };

  let html = '';
  if (active.length > 0) {
    html += `<tr class="table-group-header"><td colspan="5">Active Engagements</td></tr>`;
    html += active.map(renderCollabRow).join('');
  }
  if (pending.length > 0) {
    html += `<tr class="table-group-header"><td colspan="5">Pending Proposals</td></tr>`;
    html += pending.map(renderCollabRow).join('');
  }
  if (completed.length > 0) {
    html += `<tr class="table-group-header"><td colspan="5">Past Collaborations</td></tr>`;
    html += completed.map(renderCollabRow).join('');
  }

  if (!all.length) {
    tbody.innerHTML = `<tr><td class="table-empty" colspan="5">No contracts found.</td></tr>`;
    return;
  }

  tbody.innerHTML = html;
}


/** Modals Management */
function initModals() {
  const profileModal = document.getElementById('profile-modal');
  const detailModal = document.getElementById('detail-modal');

  document.getElementById('btn-edit-profile')?.addEventListener('click', () => openProfileModal());
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      profileModal.classList.remove('is-open');
      detailModal.classList.remove('is-open');
    });
  });
}

function openDetailModal(title, body) {
  const modal = document.getElementById('detail-modal');
  document.getElementById('detail-modal-title').textContent = title;
  document.getElementById('detail-modal-body').innerHTML = body;
  modal.classList.add('is-open');
}

function openProfileModal() {
  const modal = document.getElementById('profile-modal');
  const body = document.getElementById('profile-modal-body');
  const isFarm = state.me?.role === 'FARM_MANAGER';
  const p = state.profile || {};

  body.innerHTML = `
    <form id="profile-edit-form">
      <div class="form-group">
        <label>Name</label>
        <input type="text" name="name" value="${escapeHtml(p.name)}" required />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${isFarm ? 'Biomass Type' : 'Required Type'}</label>
          <input type="text" name="type1" value="${escapeHtml(isFarm ? p.waste_type : p.required_type)}" required />
        </div>
        <div class="form-group">
          <label>Quantity (t/y)</label>
          <input type="number" name="qty1" value="${isFarm ? p.quantity : p.quantity_needed}" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>${isFarm ? 'Desired Type' : 'Byproduct Type'}</label>
          <input type="text" name="type2" value="${escapeHtml(isFarm ? p.desired_type : p.byproduct_type)}" />
        </div>
        <div class="form-group">
          <label>Quantity (t/y)</label>
          <input type="number" name="qty2" value="${isFarm ? p.desired_quantity : p.byproduct_quantity}" />
        </div>
      </div>
      <div class="form-group">
        <label>Description</label>
        <textarea name="description">${escapeHtml(p.description)}</textarea>
      </div>
      <div class="form-group">
        <label>Location</label>
        <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;">
          <input type="text" id="profile-location-input" placeholder="Search city, town, or address..." style="flex:1" />
          <button type="button" class="btn btn-secondary" id="profile-locate-btn">Search</button>
        </div>
        <div id="profile-location-hint" style="font-size:0.85rem; color: #8fa99a; margin-bottom:0.5rem;">
          ${p.latitude ? `Pinned: ${Number(p.latitude).toFixed(4)}, ${Number(p.longitude).toFixed(4)}` : 'Search for a location or use GPS.'}
        </div>
        <div id="profile-location-error" style="font-size:0.85rem; color: #ff4d4d; margin-bottom:0.5rem;"></div>
        <input type="hidden" name="latitude" id="profile-lat" value="${p.latitude || ''}" />
        <input type="hidden" name="longitude" id="profile-lng" value="${p.longitude || ''}" />
        <button type="button" class="btn btn-outline" id="profile-geolocate-btn" style="width:100%; font-size:0.85rem;">
          📍 Use Current Location
        </button>
      </div>
      <div class="modal-footer" style="margin-top:1rem;">
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  `;

  // Location Handlers
  const setLocStatus = (text) => { document.getElementById('profile-location-hint').textContent = text; };
  const setLocError = (text) => { document.getElementById('profile-location-error').textContent = text; };

  document.getElementById('profile-locate-btn').addEventListener('click', async () => {
    const query = document.getElementById('profile-location-input').value.trim();
    if (!query) return setLocError('Please enter a location name.');
    setLocError('');
    setLocStatus('Searching...');
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (!data.length) throw new Error('No results found.');
      document.getElementById('profile-lat').value = data[0].lat;
      document.getElementById('profile-lng').value = data[0].lon;
      setLocStatus(`Pinned: ${data[0].display_name}`);
    } catch (err) {
      setLocError(err.message);
      setLocStatus('Search failed.');
    }
  });

  document.getElementById('profile-geolocate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) return setLocError('Geolocation not supported.');
    setLocStatus('Getting current position...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById('profile-lat').value = pos.coords.latitude;
        document.getElementById('profile-lng').value = pos.coords.longitude;
        setLocStatus('Pinned to your current location.');
      },
      (err) => { setLocError('Unable to get location.'); },
      { enableHighAccuracy: true }
    );
  });

  document.getElementById('profile-edit-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const lat = fd.get('latitude');
    const lng = fd.get('longitude');

    if (!lat || !lng) {
      alert('Please search and pin a location first.');
      return;
    }

    const isFarm = state.me?.role === 'FARM_MANAGER';
    const payload = {
      name: fd.get('name'),
      description: fd.get('description') || "",
      latitude: parseFloat(lat),
      longitude: parseFloat(lng),
    };

    if (isFarm) {
      payload.waste_type = fd.get('type1');
      payload.quantity = parseFloat(fd.get('qty1')) || 0;
      payload.desired_type = fd.get('type2') || "";
      payload.desired_quantity = parseFloat(fd.get('qty2')) || 0;
    } else {
      payload.required_type = fd.get('type1');
      payload.quantity_needed = parseFloat(fd.get('qty1')) || 0;
      payload.byproduct_type = fd.get('type2') || "";
      payload.byproduct_quantity = parseFloat(fd.get('qty2')) || 0;
    }

    const path = isFarm ? '/farms/mine' : '/industries/mine';
    try {
      state.profile = await apiFetch(path, { method: 'PATCH', body: JSON.stringify(payload) });
      modal.classList.remove('is-open');
      await refreshData();
    } catch (err) {
      alert(err.message);
    }
  });

  modal.classList.add('is-open');
}

// --- Global Event Listeners ---
document.body.addEventListener('click', async (e) => {
  const t = e.target;
  const isFarm = state.me?.role === 'FARM_MANAGER';

  // 1. Propose Collaboration
  if (t.classList.contains('btn-invite')) {
    const { flow, srcId, dstId, srcType, dstType } = t.dataset;
    try {
      let farm_id, industry_id;

      if (isFarm) {
        // User is a farm manager — their farm is always farm_id
        farm_id = state.profile.id;
        // Find the INDUSTRY side of the match to use as industry_id
        if (dstType === 'INDUSTRY') {
          industry_id = dstId;
        } else if (srcType === 'INDUSTRY') {
          industry_id = srcId;
        } else {
          alert('This match is between two farms. Farm-to-Farm collaborations are not yet supported via contracts.');
          return;
        }
      } else {
        // User is industry manager — their industry is always industry_id
        industry_id = state.profile.id;
        // Find the FARM side of the match to use as farm_id
        if (srcType === 'FARM') {
          farm_id = srcId;
        } else if (dstType === 'FARM') {
          farm_id = dstId;
        } else {
          alert('This match is between two industries. Industry-to-Industry collaborations are not yet supported via contracts.');
          return;
        }
      }

      await apiFetch('/collaborations', {
        method: 'POST',
        body: JSON.stringify({ farm_id, industry_id, flow })
      });
      alert('Collaboration proposal sent!');
      document.getElementById('detail-modal').classList.remove('is-open');
      await refreshData();
    } catch (err) { alert(err.message); }
  }

  // 2. Manage Contract
  if (t.classList.contains('btn-view-collab')) {
    const collabId = t.dataset.id;
    const collab = state.collaborations.find(c => c.id === collabId);
    if (!collab) return;

    const cp = isFarm ? collab.industry : collab.farm;
    const isPending = collab.status === 'PENDING';
    const isRequester = collab.requestedById === state.me.id;

    let actionsHtml = '';
    if (isPending && !isRequester) {
      actionsHtml += `<button class="btn btn-primary btn-collab-action" data-id="${collabId}" data-status="ACTIVE">Accept Engagement</button>`;
    }
    if (collab.status === 'ACTIVE') {
      actionsHtml += `<button class="btn btn-secondary btn-collab-action" data-id="${collabId}" data-status="COMPLETED">Mark Completed</button>`;
    }
    if (['PENDING', 'ACTIVE'].includes(collab.status)) {
      actionsHtml += `<button class="btn btn-outline btn-collab-action" data-id="${collabId}" data-status="CANCELLED" style="color: #ff4d4d; border-color: #ff4d4d">Cancel Contract</button>`;
    }

    // Find if there's a match stored for this collaboration pair to show economic data
    const relatedMatch = (state.optimize?.matches || []).find(m =>
      (m.src_id === collab.farm_id && m.dst_id === collab.industry_id) ||
      (m.src_id === collab.industry_id && m.dst_id === collab.farm_id)
    );

    const flowLabel = collab.flow === 'FARM_TO_INDUSTRY' ? 'Farm → Industry' : 'Industry → Farm';
    const isActive = collab.status === 'ACTIVE';
    const isCompleted = collab.status === 'COMPLETED';
    const requesterLabel = collab.requestedByRole === 'FARM_MANAGER' ? 'Farm' : 'Industry';

    // Build counterparty detail block
    let cpDetails = '';
    if (cp) {
      const isFarmCp = !!collab.farm && cp.id === collab.farm.id;
      const materialLine = isFarmCp
        ? `<div class="detail-row"><strong>Supplies:</strong> ${escapeHtml(cp.waste_type || '—')} · ${cp.quantity ? formatNumber(cp.quantity) + ' t/yr' : '—'}</div>`
        : `<div class="detail-row"><strong>Needs:</strong> ${escapeHtml(cp.required_type || '—')} · ${cp.quantity_needed ? formatNumber(cp.quantity_needed) + ' t/yr' : '—'}</div>`;
      cpDetails = `
        <div class="detail-row"><strong>Counterparty:</strong> ${escapeHtml(cp.name || '—')}</div>
        <div class="detail-row"><strong>Type:</strong> ${isFarmCp ? 'Farm' : 'Industry'}</div>
        ${materialLine}
        ${cp.description ? `<div class="detail-row"><strong>About:</strong> ${escapeHtml(cp.description)}</div>` : ''}
      `;
    }

    // Build optimizer match data if available
    let matchData = '';
    if (relatedMatch) {
      matchData = `
        <hr style="border-color: rgba(255,255,255,0.1); margin: 1rem 0"/>
        <div class="detail-row" style="font-size:0.8rem; color: var(--color-text-muted); letter-spacing:0.08em; text-transform:uppercase">Optimizer Insights</div>
        <div class="detail-row"><strong>Matched Quantity:</strong> ${formatNumber(relatedMatch.quantity_matched)} tonnes</div>
        <div class="detail-row"><strong>Projected Revenue:</strong> ${formatCurrency(relatedMatch.revenue)}</div>
        <div class="detail-row"><strong>Transport Cost:</strong> ${formatCurrency(relatedMatch.transport_cost)}</div>
        <div class="detail-row"><strong>Distance:</strong> ${relatedMatch.distance_km} km</div>
        <div class="detail-row"><strong>CO₂ Saved:</strong> ${formatNumber(relatedMatch.co2_saved)} tCO₂e</div>
        <div class="detail-row"><strong>Sustainability Score:</strong> ${(relatedMatch.sustainability_score * 100).toFixed(0)}%</div>
      `;
    }

    openDetailModal(`${isCompleted ? '✅' : isActive ? '🔗' : '⏳'} ${cp?.name || 'Contract'}`, `
      <hr style="border-color: rgba(255,255,255,0.1); margin: 0.5rem 0 1rem"/>
      <div class="detail-row" style="font-size:0.8rem; color: var(--color-text-muted); letter-spacing:0.08em; text-transform:uppercase">Contract Details</div>
      <div class="detail-row"><strong>Status:</strong> <span class="status-pill status-${collab.status.toLowerCase()}">${collab.status}</span></div>
      <div class="detail-row"><strong>Material Flow:</strong> ${flowLabel}</div>
      <div class="detail-row"><strong>Initiated by:</strong> ${requesterLabel}</div>
      <div class="detail-row"><strong>Proposed:</strong> ${new Date(collab.createdAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
      ${collab.respondedAt ? `<div class="detail-row"><strong>Responded:</strong> ${new Date(collab.respondedAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}</div>` : ''}
      ${collab.notes ? `<div class="detail-row"><strong>Notes:</strong> ${escapeHtml(collab.notes)}</div>` : ''}
      <hr style="border-color: rgba(255,255,255,0.1); margin: 1rem 0"/>
      <div class="detail-row" style="font-size:0.8rem; color: var(--color-text-muted); letter-spacing:0.08em; text-transform:uppercase">Counterparty Profile</div>
      ${cpDetails}
      ${matchData}
      <div class="modal-footer" style="margin-top:2rem; display:flex; gap:1rem; flex-wrap:wrap">
        ${actionsHtml || '<p class="muted">No actions available for this status.</p>'}
      </div>
    `);
  }

  // 3. Status Update Action
  if (t.classList.contains('btn-collab-action')) {
    const { id, status } = t.dataset;
    try {
      await apiFetch(`/collaborations/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      alert(`Contract updated to ${status}`);
      document.getElementById('detail-modal').classList.remove('is-open');
      await refreshData();
    } catch (err) { alert(err.message); }
  }
});

/** Core: Data Fetching and Orchestration */
async function initHeader() {
  const emailEl = document.getElementById('user-email');
  try {
    state.me = await apiFetch('/auth/me');
    if (emailEl) emailEl.textContent = state.me.email;

    document.getElementById('profile-role-label').textContent = state.me.role === 'FARM_MANAGER' ? 'Farm Manager' : 'Industry Manager';

    // Fetch profile
    const path = state.me.role === 'FARM_MANAGER' ? '/farms/mine' : '/industries/mine';
    try {
      state.profile = await apiFetch(path);
      document.getElementById('profile-name').textContent = state.profile.name;
      document.getElementById('availability-toggle').checked = state.profile.isActive;
    } catch (err) {
      document.getElementById('profile-name').textContent = 'Profile required';
    }

  } catch (err) {
    setStoredJwt(null);
    window.location.replace('login.html');
    return;
  }

  document.getElementById('btn-logout')?.addEventListener('click', () => {
    setStoredJwt(null);
    window.location.href = 'login.html';
  });

  document.getElementById('availability-toggle')?.addEventListener('change', async (e) => {
    const isActive = e.target.checked;
    const path = state.me.role === 'FARM_MANAGER' ? '/farms/mine' : '/industries/mine';
    try {
      state.profile = await apiFetch(path, { method: 'PATCH', body: JSON.stringify({ isActive }) });
      await refreshData();
    } catch (err) {
      alert(err.message);
      e.target.checked = !isActive;
    }
  });
}

function initSliders() {
  ['transport', 'allocation', 'supply', 'demand'].forEach(key => {
    const s = document.getElementById(`${key}-slider`);
    const v = document.getElementById(`${key}-value`);
    if (!s || !v) return;
    s.addEventListener('input', () => {
      let val = s.value;
      if (key === 'allocation') {
        val = ['Distance', 'Balanced', 'Revenue'][val];
      } else {
        val = `${Number(val).toFixed(1)}×`;
      }
      v.textContent = val;
      scheduleSimulation();
    });
  });
}

function getSimulationParams() {
  const allocationIndex = Number(document.getElementById('allocation-slider')?.value ?? 1);
  return {
    transport_cost_multiplier: Number(document.getElementById('transport-slider')?.value ?? 1),
    allocation_mode: ['distance', 'balanced', 'revenue'][allocationIndex],
    supply_multiplier: Number(document.getElementById('supply-slider')?.value ?? 1),
    demand_multiplier: Number(document.getElementById('demand-slider')?.value ?? 1),
  };
}

let simulationTimer = null;
function scheduleSimulation() {
  if (simulationTimer) window.clearTimeout(simulationTimer);
  simulationTimer = window.setTimeout(refreshData, 450);
}

function showSkeletons() {
  const impact = document.getElementById('impact-cards');
  const listings = document.getElementById('listing-cards');
  const matches = document.getElementById('matches-tbody');
  const contracts = document.getElementById('contracts-tbody');
  const ai = document.getElementById('ai-panel');

  if (impact) {
    impact.innerHTML = `
      <div class="impact-card skeleton" style="min-height:80px"></div>
      <div class="impact-card skeleton" style="min-height:80px"></div>
      <div class="impact-card skeleton" style="min-height:80px"></div>
      <div class="impact-card skeleton" style="min-height:80px"></div>
    `;
  }
  if (listings) {
    listings.innerHTML = `
      <div class="listing-card skeleton" style="min-height:100px"></div>
      <div class="listing-card skeleton" style="min-height:100px"></div>
    `;
  }
  if (matches) {
    matches.innerHTML = Array(5).fill(0).map(() => `
      <tr><td colspan="8"><div class="skeleton" style="height:24px; margin:4px 0; width:100%"></div></td></tr>
    `).join('');
  }
  if (contracts) {
    contracts.innerHTML = Array(3).fill(0).map(() => `
      <tr><td colspan="5"><div class="skeleton" style="height:24px; margin:4px 0; width:100%"></div></td></tr>
    `).join('');
  }
  if (ai) {
    ai.innerHTML = `
      <div class="skeleton skeleton-text" style="width:40%; margin-bottom:1rem"></div>
      <div class="skeleton skeleton-text" style="width:90%"></div>
      <div class="skeleton skeleton-text" style="width:85%"></div>
      <div class="skeleton skeleton-text" style="width:95%"></div>
    `;
  }
}

async function refreshData() {
  showSkeletons();
  try {
    const [farms, industries, collaborations] = await Promise.all([
      apiFetch('/farms').catch(() => []),
      apiFetch('/industries').catch(() => []),
      apiFetch('/collaborations/mine').catch(() => [])
    ]);
    state.directory = { farms, industries };
    state.collaborations = collaborations;
  } catch (err) {
    console.error('Failed to update directory:', err);
    state.directory = { farms: [], industries: [] };
  }

  const { farms, industries } = state.directory;
  let optimize = { matches: [], impact_metrics: { total_revenue: 0, total_transport_cost: 0, co2_saved: 0, landfill_diverted: 0, net_value: 0, match_count: 0 } };

  if ((farms.length + industries.length) >= 2) {
    try {
      optimize = await apiFetch('/optimize', {
        method: 'POST',
        body: JSON.stringify({ simulation: getSimulationParams(), persist: false, include_ai: true })
      });
    } catch (err) { console.warn('Optimize failed:', err); }
  }

  state.optimize = optimize;
  renderImpactCards(optimize);
  renderListings();
  renderMatchesTable(optimize);
  renderContractsTable();

  if (state.me && state.profile) {
    initRoleMap({
      role: state.me.role,
      primary: state.profile,
      collaborations: state.collaborations,
      allFarms: farms,
      allIndustries: industries
    });
  } else {
    initMap({ farms, industries, matches: optimize.matches });
  }

  initCharts({ farms, matches: optimize.matches });
  initAiInsights(optimize);
}

async function init() {
  await initHeader();
  initModals();
  initSliders();
  await refreshData();
}

init();
