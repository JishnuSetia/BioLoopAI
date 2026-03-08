/**
 * BioLoop AI – AI Insights panel.
 * Renders backend-provided explanation + recommendations (Ollama) with fallback text.
 */

export function initAiInsights(data) {
  const panel = document.getElementById('ai-panel');
  if (!panel) return;

  const explanation = data?.explanation || '';
  const sustainability = data?.sustainability_summary || '';
  const recommendations = Array.isArray(data?.recommendations) ? data.recommendations : [];

  panel.innerHTML = `
    <h3>AI-generated insights</h3>
    <ul class="insight-list">
      <li class="insight-item">
        <div class="title">Why these matches</div>
        <div class="summary">${escapeHtml(explanation || 'AI explanation unavailable.')}</div>
      </li>
      <li class="insight-item">
        <div class="title">Sustainability summary</div>
        <div class="summary">${escapeHtml(sustainability || '—')}</div>
      </li>
      <li class="insight-item">
        <div class="title">Strategic recommendations</div>
        <div class="summary">
          ${recommendations.length ? `<ol style="margin:0.5rem 0 0; padding-left: 1.25rem;">${recommendations.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ol>` : '—'}
        </div>
      </li>
    </ul>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('\n', '<br/>');
}
