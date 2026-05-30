const pageData = JSON.parse(document.getElementById("page-data")?.textContent || "{}").payload || {};
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = value => value === null || value === undefined ? "-" : esc(value);

function cards(target, items) {
  const node = $(target);
  if (!node) return;
  node.innerHTML = items.map(item => `<article class="metric"><div class="label">${esc(item.label)}</div><div class="value">${fmt(item.value)}</div></article>`).join("");
}
function table(target, headers, rows) {
  const node = $(target);
  if (!node) return;
  node.innerHTML = `<thead><tr>${headers.map(h => `<th>${esc(h.label)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr ${row.click ? `data-click="${esc(row.click)}"` : ""}>${headers.map(h => `<td ${h.class ? `class="${h.class}"` : ""}>${fmt(h.value(row))}</td>`).join("")}</tr>`).join("")}</tbody>`;
}
function bars(target, rows, labelKey = "label", valueKey = "count") {
  const node = $(target);
  if (!node) return;
  const max = Math.max(...rows.map(row => Number(row[valueKey]) || 0), 1);
  node.innerHTML = rows.length ? rows.map(row => {
    const value = Number(row[valueKey]) || 0;
    return `<div class="bar-row"><div>${esc(row[labelKey])}</div><div class="bar"><span style="width:${Math.round(value / max * 100)}%"></span></div><div class="id">${value}</div></div>`;
  }).join("") : `<span class="muted">No data yet</span>`;
}

function pct(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

function topDistribution(distribution, limit = 6) {
  return Object.entries(distribution || {})
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
    .slice(0, Math.max(1, Number(limit) || 1));
}

function renderRetrievalDiversity(target, summary) {
  const node = $(target);
  if (!node) return;
  const section = (title, dim) => {
    const rows = topDistribution(dim?.distribution || {}, 6);
    return `<article class="diversity-dim">
      <h3>${esc(title)}</h3>
      <div class="diversity-kpis">
        <div><span>Norm Entropy</span><strong>${fmt(dim?.normalized_entropy ?? 0)}</strong></div>
        <div><span>Top1 Share</span><strong>${pct(dim?.top1_share ?? 0)}</strong></div>
        <div><span>Distinct</span><strong>${fmt(dim?.distinct_count ?? 0)}</strong></div>
        <div><span>Total</span><strong>${fmt(dim?.total ?? 0)}</strong></div>
      </div>
      <div class="dist-list">
        ${rows.length
    ? rows.map(([key, count]) => `<div class="dist-item"><span>${esc(key)}</span><strong>${fmt(count)}</strong></div>`).join("")
    : `<span class="muted">No data yet</span>`}
      </div>
    </article>`;
  };

  node.innerHTML = `<div class="diversity-head">
    <span class="badge">Window: ${esc(summary?.window_days ?? 7)} days</span>
    <span class="badge">Top N per recall: ${esc(summary?.top_n_per_recall ?? 10)}</span>
    <span class="badge">Recall events: ${esc(summary?.recall_count ?? 0)}</span>
    <span class="badge">Sampled items: ${esc(summary?.sampled_items_total ?? 0)}</span>
  </div>
  <div class="diversity-grid">
    ${section("Category Diversity", summary?.category)}
    ${section("Source Type Diversity", summary?.source_type)}
    ${section("Path Prefix Diversity", summary?.path_prefix)}
  </div>`;
}

function renderReinforcementConcentration(target, summary) {
  const node = $(target);
  if (!node) return;
  const topMemories = Array.isArray(summary?.top_memories) ? summary.top_memories : [];
  node.innerHTML = `<div class="diversity-head">
    <span class="badge">Window: ${esc(summary?.window_days ?? 7)} days</span>
    <span class="badge">Top N per recall: ${esc(summary?.top_n_per_recall ?? 10)}</span>
  </div>
  <div class="diversity-grid concentration-grid">
    <article class="diversity-dim">
      <h3>Summary</h3>
      <div class="diversity-kpis">
        <div><span>Total References</span><strong>${fmt(summary?.total_references ?? 0)}</strong></div>
        <div><span>Unique Memories</span><strong>${fmt(summary?.unique_memories ?? 0)}</strong></div>
        <div><span>Recall Events</span><strong>${fmt(summary?.recall_count ?? 0)}</strong></div>
        <div><span>HHI</span><strong>${fmt(summary?.hhi ?? 0)}</strong></div>
      </div>
    </article>
    <article class="diversity-dim">
      <h3>Concentration</h3>
      <div class="diversity-kpis">
        <div><span>Top1 Share</span><strong>${pct(summary?.top1_share ?? 0)}</strong></div>
        <div><span>Top5 Share</span><strong>${pct(summary?.top5_share ?? 0)}</strong></div>
        <div><span>Top10 Share</span><strong>${pct(summary?.top10_share ?? 0)}</strong></div>
      </div>
    </article>
  </div>
  <div class="panel table-wrap">
    <table class="top-memories">
      <thead><tr><th>Memory</th><th>Count</th><th>Share</th><th>Category</th><th>Path</th></tr></thead>
      <tbody>
        ${topMemories.length
    ? topMemories.map(item => `<tr><td class="id">${esc(item.id)}</td><td>${fmt(item.count)}</td><td>${pct(item.share)}</td><td>${esc(item.category || 'unknown')}</td><td>${esc(item.path || 'unknown')}</td></tr>`).join("")
    : `<tr><td colspan="5" class="muted">No data yet</td></tr>`}
      </tbody>
    </table>
  </div>`;
}
async function api(path, options) {
  const res = await fetch(path, options);
  return res.json();
}

function initDashboard() {
  if (!$('[data-dashboard-cards]')) return;
  const counts = Object.fromEntries((pageData.eventCounts || []).map(row => [row.event_type, row.count]));
  const telemetry = pageData.telemetry || {};
  const totals = telemetry.totals || {};
  cards('[data-dashboard-cards]', [
    { label: 'Memories', value: pageData.memoryCount || 0 },
    { label: 'Active', value: pageData.activeCount || 0 },
    { label: 'Archived', value: pageData.archivedCount || 0 },
    { label: 'Recall 7d', value: counts.recall_completed || 0 },
  ]);
  cards('[data-recall-cards]', [
    { label: 'Auto Recall', value: totals.completed || 0 },
    { label: 'Candidates', value: totals.candidates || 0 },
    { label: 'Injected', value: totals.injected || 0 },
    { label: 'Avg Latency', value: totals.avg_latency_ms ? `${totals.avg_latency_ms}ms` : '-' },
  ]);
  bars('[data-recall-bars]', telemetry.byHour || [], 'bucket', 'count');
  const tz = telemetry.timezone || 'Asia/Shanghai';
  const started = totals.started || 0;
  const completed = totals.completed || 0;
  const injected = totals.injected || 0;
  const candidates = totals.candidates || 0;
  const injectionRate = candidates ? Math.round(injected / candidates * 100) : 0;
  const completionRate = started ? Math.round(completed / started * 100) : 0;
  const summary = $('[data-recall-summary]');
  if (summary) {
    summary.innerHTML = `<div class="summary-grid">
      <div><span class="muted">Timezone</span><strong>${esc(tz)}</strong></div>
      <div><span class="muted">Completion</span><strong>${completionRate}%</strong></div>
      <div><span class="muted">Injection</span><strong>${injectionRate}%</strong></div>
      <div><span class="muted">Buckets</span><strong>${esc((telemetry.byHour || []).length)}</strong></div>
    </div>`;
  }
  bars('[data-event-mix]', pageData.eventCounts || [], 'event_type', 'count');
  table('[data-recent-events]', [
    { label: 'Time', value: r => r.created_at },
    { label: 'Event', value: r => r.event_type },
    { label: 'Memory', value: r => (r.memory_id || '').slice(0, 16), class: 'id' },
    { label: 'Source', value: r => r.source },
  ], pageData.recentEvents || []);
}

function initTraces() {
  if (!$('[data-traces]')) return;
  table('[data-traces]', [
    { label: 'Trace', value: r => (r.trace_id || '').slice(0, 16), class: 'id' },
    { label: 'Session', value: r => (r.session_id || '').slice(0, 18), class: 'id' },
    { label: 'Candidates', value: r => r.candidate_count ?? 0 },
    { label: 'Injected', value: r => r.injected_count ?? 0 },
    { label: 'Latency', value: r => r.latency_ms ? `${r.latency_ms}ms` : '-' },
    { label: 'Completed', value: r => r.completed_at },
  ], (pageData.traces || []).map(row => ({ ...row, click: row.trace_id })));
  $('[data-traces]')?.addEventListener('click', async event => {
    const row = event.target.closest('tr[data-click]');
    if (!row) return;
    const trace = await api(`/api/traces/${encodeURIComponent(row.dataset.click)}`);
    $('[data-trace-detail]').innerHTML = `<div class="detail">
      <div><span class="badge">${esc(trace.candidate_count)} candidates</span> <span class="badge">${esc(trace.injected_count)} injected</span> <span class="badge">${esc(trace.latency_ms || 0)}ms</span></div>
      ${trace.events.map(e => `<pre>${esc(e.created_at)}  ${esc(e.event_type)}  ${esc(e.memory_id || '')}\n${esc(JSON.stringify(e.metadata || {}, null, 2))}</pre>`).join('')}
    </div>`;
  });
}

function initMemories() {
  if (!$('[data-memories]')) return;
  const renderRows = rows => table('[data-memories]', [
    { label: 'ID', value: r => r.short_id, class: 'id' },
    { label: 'Category', value: r => r.category },
    { label: 'Conf Mode', value: r => r.confidence_mode },
    { label: 'Source', value: r => r.source_type },
    { label: 'External', value: r => r.external_badge ? 'yes' : 'no' },
    { label: 'Conf', value: r => r.confidence?.toFixed ? r.confidence.toFixed(3) : r.confidence },
    { label: 'Hits', value: r => r.hit_count },
    { label: 'Decay', value: r => r.decay_eligible ? 'yes' : 'no' },
    { label: 'Archive', value: r => r.archive_eligible ? 'yes' : 'no' },
    { label: 'Flags', value: r => `${r.is_protected ? 'protected ' : ''}${r.conflict_flag ? 'conflict ' : ''}${r.is_archived ? 'archived' : ''}` },
    { label: 'Text', value: r => (r.text || '').slice(0, 140) },
  ], rows.map(row => ({ ...row, click: row.id })));
  renderRows(pageData.memories || []);
  $('[data-memories]')?.addEventListener('click', async event => {
    const row = event.target.closest('tr[data-click]');
    if (!row) return;
    const memory = await api(`/api/memories/${encodeURIComponent(row.dataset.click)}`);
    $('[data-memory-detail]').innerHTML = `<div class="detail">
      <div><span class="badge id">${esc(memory.short_id)}</span> <span class="badge">${esc(memory.category)}</span> <span class="badge">${esc(memory.confidence_mode || 'managed')}</span> <span class="badge">${esc(memory.source_type || 'memory-engine-managed')}</span> ${memory.external_badge ? '<span class="badge">external</span>' : ''}</div>
      <pre>${esc(memory.text || '')}</pre>
      <div class="muted">${esc(memory.path || '')}</div>
      <div class="muted">decay_eligible=${esc(String(Boolean(memory.decay_eligible)))} archive_eligible=${esc(String(Boolean(memory.archive_eligible)))}</div>
      <div class="actions"><button data-archive="${esc(memory.id)}">Archive</button><button class="danger" data-delete="${esc(memory.id)}">Delete</button></div>
    </div>`;
  });
  $('[data-memory-search]')?.addEventListener('click', async () => {
    const q = encodeURIComponent($('[data-memory-query]').value || '');
    const archived = encodeURIComponent($('[data-memory-archived]').value || 'active');
    renderRows(await api(`/api/memories?q=${q}&archived=${archived}`));
  });
  $('[data-memory-detail]')?.addEventListener('click', async event => {
    const archiveId = event.target.dataset.archive;
    const deleteId = event.target.dataset.delete;
    if (archiveId) await api(`/api/memories/${encodeURIComponent(archiveId)}/archive`, { method: 'POST' });
    if (deleteId) await api(`/api/memories/${encodeURIComponent(deleteId)}/delete`, { method: 'POST' });
    if (archiveId || deleteId) location.reload();
  });
}

function initTelemetry() {
  if (!$('[data-recall-cards]')) return;
  const totals = pageData.totals || {};
  cards('[data-recall-cards]', [
    { label: 'Started', value: totals.started || 0 },
    { label: 'Completed', value: totals.completed || 0 },
    { label: 'Injected', value: totals.injected || 0 },
    { label: 'Avg Latency', value: totals.avg_latency_ms ? `${totals.avg_latency_ms}ms` : '-' },
  ]);
  bars('[data-recall-bars]', pageData.byHour || [], 'bucket', 'count');
  api('/api/telemetry/latency').then(rows => table('[data-latency]', [
    { label: 'Time', value: r => r.created_at },
    { label: 'Event', value: r => r.event_type },
    { label: 'Latency', value: r => `${r.latency_ms}ms` },
    { label: 'Trace', value: r => (r.trace_id || '').slice(0, 16), class: 'id' },
  ], rows));
}

function initMetrics() {
  if (!$('[data-metric-cards]')) return;
  const overview = pageData.overview || {};
  const conf = overview.confidence || {};
  const reinforcement = overview.reinforcement || {};
  const retrieval = pageData.retrieval || {};
  const diversity = retrieval.diversity || {};
  const retrievalDiversity = retrieval.retrieval_diversity || {};
  const reinforcementConcentration = retrieval.reinforcement_concentration || {};
  cards('[data-metric-cards]', [
    { label: 'Events', value: overview.events || 0 },
    { label: 'Memories', value: overview.memories || 0 },
    { label: 'Avg Confidence', value: conf.avg_confidence ?? '-' },
    { label: 'Conflicts', value: conf.conflicts || 0 },
  ]);
  cards('[data-diversity-cards]', [
    { label: 'Div Window', value: `${diversity.window_days || 7}d` },
    { label: 'Distinct Categories', value: diversity.distinct_categories ?? 0 },
    { label: 'Norm Entropy', value: diversity.normalized_entropy ?? 0 },
    { label: 'Top1 Share', value: diversity.top1_share !== undefined ? `${Math.round((diversity.top1_share || 0) * 100)}%` : '-' },
  ]);
  cards('[data-reinforcement-cards]', [
    { label: 'Active Memories', value: reinforcement.active_memories ?? 0 },
    { label: 'Reinforced', value: reinforcement.reinforced_memories ?? 0 },
    { label: 'Top10 Share', value: reinforcement.top10_share !== undefined ? `${Math.round((reinforcement.top10_share || 0) * 100)}%` : '-' },
    { label: 'HHI', value: reinforcement.hhi ?? 0 },
  ]);
  bars('[data-category-bars]', retrieval.categories || [], 'category', 'count');
  renderRetrievalDiversity('[data-retrieval-diversity]', retrievalDiversity);
  renderReinforcementConcentration('[data-reinforcement-concentration]', reinforcementConcentration);
  table('[data-conflicts]', [
    { label: 'Category', value: r => r.category },
    { label: 'Count', value: r => r.count },
    { label: 'Avg Confidence', value: r => r.avg_confidence },
  ], pageData.conflicts || []);
}

document.querySelector('[data-refresh]')?.addEventListener('click', () => location.reload());
initDashboard();
initTraces();
initMemories();
initTelemetry();
initMetrics();
