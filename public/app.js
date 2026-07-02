const STAGES = ["New", "Contacted", "Follow-Up", "Offer Made", "Backup Offer", "Under Contract", "Assigned", "Closed", "Dead"];
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const money = (n) => (n || n === 0) ? "$" + Number(n).toLocaleString() : "—";
const api = async (url, opts) => {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
};
function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show" + (isErr ? " err" : "");
  setTimeout(() => (t.className = "toast"), 2600);
}

let leads = [], buyers = [], settings = {}, currentLeadId = null, currentBuyerId = null;

// ---------- Tabs ----------
$$(".tab").forEach((b) =>
  b.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.remove("active"));
    $$(".view").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $("#" + b.dataset.tab).classList.add("active");
    if (b.dataset.tab === "dashboard") loadDashboard();
    if (b.dataset.tab === "dealcalc") { fillAttachLeads(); applyOfferType(); runDealCalc(); }
    if (b.dataset.tab === "outreach") openOutreach();
    if (b.dataset.tab === "inbox") openInbox();
    if (b.dataset.tab === "seller-intake") loadSellerIntake();
    if (b.dataset.tab === "offers") loadOffers();
    if (b.dataset.tab === "acquisitions") openAcquisitions();
    if (b.dataset.tab === "sources") { loadSearchPlans(); loadEcosystemMeta(); loadSources(); loadSpreadAudit(); loadEngineHistory(); loadLeadEngineSettings(); loadCouncilJobs(); }
    if (b.dataset.tab === "map") loadMap();
    if (b.dataset.tab === "fill") loadFill();
  })
);

// ---------- Built-in map (free OpenStreetMap; no key) ----------
let _map = null, _markers = null;
function loadMap() {
  if (typeof L === "undefined") { $("#mapStatus").innerHTML = '<span class="err">Map needs internet to load tiles.</span>'; return; }
  if (!_map) {
    _map = L.map("mapCanvas").setView([42.331, -83.046], 11); // default: Detroit
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(_map);
    _markers = L.layerGroup().addTo(_map);
  }
  refreshMapPoints();
}
async function refreshMapPoints() {
  if (!_map) return;
  try {
    const d = await api("/api/map/points");
    _markers.clearLayers();
    const pts = d.points || [];
    $("#mapStatus").textContent = `${pts.length} located lead${pts.length === 1 ? "" : "s"}`;
    const bounds = [];
    for (const p of pts) {
      const m = L.marker([p.latitude, p.longitude]).bindPopup(
        `<b>${p.address || ""}</b><br>${p.seller_name || ""} ${p.seller_phone ? "· " + p.seller_phone : ""}<br>` +
        `Stage: ${p.stage || "—"}<br>ARV ${money(p.arv)} · MAO ${money(p.mao)}`);
      _markers.addLayer(m); bounds.push([p.latitude, p.longitude]);
    }
    if (bounds.length) _map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    setTimeout(() => _map.invalidateSize(), 80); // ensure correct sizing now the tab is visible
  } catch (e) { $("#mapStatus").innerHTML = `<span class="err">${e.message}</span>`; }
}
async function geocodeLeads() {
  const btn = $("#mapGeocode"); btn.disabled = true; const l = btn.textContent; btn.textContent = "Geocoding…";
  $("#mapStatus").textContent = "Geocoding addresses (free Census)…";
  try {
    const d = await api("/api/map/geocode", { method: "POST", body: JSON.stringify({ limit: 100 }) });
    toast(`Geocoded ${d.geocoded} · ${d.remaining} left`);
    await refreshMapPoints();
  } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.textContent = l; }
}
document.addEventListener("DOMContentLoaded", () => {
  const g = $("#mapGeocode"), r = $("#mapRefresh");
  if (g) g.addEventListener("click", geocodeLeads);
  if (r) r.addEventListener("click", refreshMapPoints);
});

// ---------- Sources scoreboard (auto-run APIs, track which are good / get leads) ----------
let searchPlans = [];

async function loadSearchPlans() {
  const sel = $("#enginePlan");
  if (!sel) return [];
  try {
    const current = sel.value || "all-enabled";
    const d = await api("/api/ecosystem/plans");
    searchPlans = d.plans || [];
    sel.innerHTML = searchPlans.map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join("");
    sel.value = searchPlans.some((p) => p.id === current) ? current : (sel.value || "all-enabled");
    return searchPlans;
  } catch {
    return searchPlans;
  }
}

async function loadEcosystemMeta() {
  const el = $("#ecosystemMeta");
  if (!el) return;
  try {
    const planId = $("#enginePlan") ? $("#enginePlan").value : "";
    const e = await api(`/api/ecosystem${planId ? `?planId=${encodeURIComponent(planId)}` : ""}`);
    el.textContent = `Ecosystem: ${e.counts.connectors_total} connector(s), ${e.counts.connectors_selected} selected by "${e.plan.name || e.plan.id}", ${e.counts.participants} participant(s).`;
    loadPlanChildren(planId || e.plan.id);
  } catch {
    el.textContent = "";
  }
}

function renderPlanChildren(d) {
  const el = $("#ecosystemPlanChildren");
  if (!el) return;
  const counts = Object.entries(d.counts || {}).map(([k, v]) => `${esc(k)}:${v}`).join(" · ") || "no children yet";
  const rows = (d.items || []).slice(0, 8).map((t) => {
    const parser = t.content?.parser_family || t.content?.parser_schema || t.schema || "";
    return `<tr><td><b>${esc(t.kind)}</b></td><td>${esc(t.name || t.id)}</td><td class="muted">${esc(t.schema || "")}</td><td class="muted">${esc(parser)}</td></tr>`;
  }).join("");
  el.innerHTML = `<div class="muted">Plan Thinga: <b>${esc(d.plan_thinga_id)}</b> · ${counts}</div>${
    rows ? `<table class="src-table" style="margin-top:6px"><thead><tr><th>Kind</th><th>Child</th><th>Schema</th><th>Parser</th></tr></thead><tbody>${rows}</tbody></table>` : ""
  }`;
}

async function loadPlanChildren(planId) {
  const el = $("#ecosystemPlanChildren");
  if (!el || !planId) return;
  try {
    const d = await api(`/api/ecosystem/plans/${encodeURIComponent(planId)}/children?limit=80`);
    renderPlanChildren(d);
  } catch {
    el.innerHTML = "";
  }
}

function srcStatusCell(r) {
  if (r.last_ok) return '<span class="pill ok">working</span>';
  const k = r.last_error_kind || "error";
  return `<span class="pill err" title="${(r.last_error || "").replace(/"/g, "&quot;")}">${k}</span>`;
}
function renderSources(rows) {
  const body = $("#srcBody");
  if (!rows || !rows.length) { body.innerHTML = '<tr><td colspan="10" class="muted">No runs yet — click “Test all sources”.</td></tr>'; return; }
  body.innerHTML = rows.map((r) => `
    <tr>
      <td><b>${r.source_id}</b></td>
      <td class="muted">${r.source_type || ""}</td>
      <td>${srcStatusCell(r)}</td>
      <td>${r.last_leads ?? "—"}</td>
      <td>${r.last_with_contact ?? "—"}</td>
      <td><b>${r.total_leads ?? 0}</b></td>
      <td>${r.success_rate ?? 0}%</td>
      <td>${r.avg_latency_ms ?? "—"} ms</td>
      <td class="muted">${r.last_ran ? new Date(r.last_ran).toLocaleString() : "—"}</td>
      <td class="muted">${r.last_error_kind || ""}</td>
    </tr>`).join("");
}
async function loadSources() {
  try {
    const d = await api("/api/sources/health");
    if (!d.enabled) { $("#srcStatus").innerHTML = '<span class="err">Postgres not configured — set DATABASE_URL to enable source tracking.</span>'; return; }
    $("#srcMeta").textContent = d.rows.length ? `${d.rows.length} sources tracked` : "";
    renderSources(d.rows);
  } catch (e) { $("#srcStatus").innerHTML = `<span class="err">${e.message}</span>`; }
}
async function probeSources() {
  const btn = $("#srcProbe");
  btn.disabled = true; const label = btn.textContent; btn.textContent = "Testing…";
  $("#srcStatus").textContent = "Running every source and recording metrics…";
  try {
    const d = await api("/api/sources/probe", { method: "POST" });
    const got = (d.results || []).reduce((s, r) => s + (r.leads || 0), 0);
    const okN = (d.results || []).filter((r) => r.ok).length;
    $("#srcStatus").innerHTML = `<span class="ok">Done — ${okN}/${(d.results||[]).length} sources working, ${got} leads found this run.</span>`;
    toast(`Tested ${(d.results||[]).length} sources · ${got} leads`);
    await loadSources();
  } catch (e) { $("#srcStatus").innerHTML = `<span class="err">${e.message}</span>`; toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = label; }
}
async function pullArea() {
  const city = $("#areaCity").value.trim(), state = $("#areaState").value.trim(), zip = $("#areaZip").value.trim();
  const skiptrace = $("#areaSkiptrace") && $("#areaSkiptrace").checked;
  if (!city && !zip) { toast("Enter a city or ZIP", true); return; }
  const btn = $("#areaPull"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Pulling…";
  $("#areaStatus").textContent = skiptrace ? "Fanning across every source + skip-tracing…" : "Fanning across every source for this area…";
  try {
    const d = await api("/api/area/pull", { method: "POST", body: JSON.stringify({ city, state, zip, skiptrace }) });
    const stMsg = d.skiptraceNote ? ` <span class="muted">${d.skiptraceNote}</span>` : "";
    $("#areaStatus").innerHTML = `<span class="ok">${d.area}: ${d.found} found · ${d.inserted} new prospects · ${d.withContact} with contact · ${d.skipped} dupes.</span>${stMsg} They're in <b>Leads → Prospects</b>.`;
    $("#areaBreakdown").innerHTML = `<table class="src-table"><thead><tr><th>Source</th><th>Type</th><th>Status</th><th>Found</th><th>Added</th><th>Latency</th></tr></thead><tbody>${
      (d.bySource || []).map((s) => `<tr><td><b>${s.source_id}</b></td><td class="muted">${s.type}</td><td>${s.ok ? '<span class="pill ok">ok</span>' : '<span class="pill err">'+(s.error_kind||"fail")+'</span>'}</td><td>${s.found}</td><td><b>${s.added}</b></td><td>${s.latency_ms} ms</td></tr>`).join("")
    }</tbody></table>`;
    toast(`${d.inserted} new prospects from ${city || zip}`);
    loadSources();
  } catch (e) { $("#areaStatus").innerHTML = `<span class="err">${e.message}</span>`; toast(e.message, true); }
  finally { btn.disabled = false; btn.textContent = label; }
}

let currentEngineRunId = null;
function renderEngineShortlist(items) {
  const el = $("#engineShortlist");
  if (!el) return;
  if (!items || !items.length) {
    el.innerHTML = `<div class="empty">No converged properties reached review score.</div>`;
    return;
  }
  el.innerHTML = `<table class="src-table"><thead><tr><th>Score</th><th>Property</th><th>Spend</th><th>Buyer demand</th><th>Reasons</th><th>Actions</th></tr></thead><tbody>${
    items.map((x) => `<tr>
      <td><b>${x.score}</b><div class="muted">${esc(x.tier)}</div></td>
      <td>${esc(x.address || x.name || x.id)}</td>
      <td>${x.status ? `<div class="muted">${esc(x.status)}</div>` : ""}${x.spend_allowed ? '<span class="pill ok">review spend</span>' : '<span class="pill err">hold</span>'}</td>
      <td>${(x.buyer_matches || []).slice(0, 2).map((b) => `${esc(b.name || "buyer")} (${b.score})`).join("<br>") || "none"}</td>
      <td class="muted">${x.spread_status ? `<b>${esc(x.spread_status)}</b>${x.projected_spread != null ? ` ${money(x.projected_spread)}` : ""}<br>` : ""}${esc((x.reasons || []).join("; "))}</td>
      <td>${x.candidate_id ? `
        <button class="btn xs cand-approve" data-id="${x.candidate_id}">Approve</button>
        <button class="btn xs cand-import" data-id="${x.candidate_id}">Import</button>
        <button class="btn xs cand-skip" data-id="${x.candidate_id}">Skiptrace</button>` : ""}</td>
    </tr>`).join("")
  }</tbody></table>`;
  $$("#engineShortlist .cand-approve").forEach((b) => b.addEventListener("click", () => updateCandidateStatus(b.dataset.id, "approved_for_skiptrace")));
  $$("#engineShortlist .cand-import").forEach((b) => b.addEventListener("click", () => importEngineCandidate(b.dataset.id)));
  $$("#engineShortlist .cand-skip").forEach((b) => b.addEventListener("click", () => skiptraceEngineCandidate(b.dataset.id)));
}

function renderSpreadAudit(d) {
  const el = $("#spreadAudit");
  if (!el) return;
  const c = d.counts || {};
  const missing = Object.entries(d.missing || {}).sort((a, b) => b[1] - a[1]).slice(0, 4)
    .map(([k, v]) => `${esc(k)} (${v})`).join(" · ");
  const rows = [...(d.works || []), ...(d.thin || []), ...(d.fails || []), ...(d.unproven || [])].slice(0, 12);
  el.innerHTML = `<div class="spread-summary">
    <span class="pill ok">works ${c.works || 0}</span>
    <span class="pill">thin ${c.thin || 0}</span>
    <span class="pill err">fails ${c.fails || 0}</span>
    <span class="pill">unproven ${c.unproven || 0}</span>
    <span class="muted">${missing || "no missing-field summary"}</span>
  </div>${
    rows.length ? `<table class="src-table"><thead><tr><th>Status</th><th>Property</th><th>Spread</th><th>Buyer</th><th>What fails next</th></tr></thead><tbody>${
      rows.map((r) => `<tr>
        <td><span class="pill ${r.status === "works" ? "ok" : r.status === "fails" ? "err" : ""}">${esc(r.status)}</span></td>
        <td><b>${esc(r.address || `#${r.id}`)}</b><div class="muted">${esc(r.record_type)} · ${esc(r.source || "")}</div></td>
        <td>${r.projected_spread != null ? money(r.projected_spread) : "—"}<div class="muted">buyer ${money(r.buyer_assignment_price)} · offer ${money(r.acquisition_offer_price)} · anchor ${money(r.seller_anchor_price || r.seller_acceptable_price)}</div>${r.anchor_spread != null && r.anchor_spread < 0 ? `<div class="muted">anchor gap ${money(r.anchor_spread)}</div>` : ""}${r.best_negotiation_path ? `<div class="muted">best ${esc(r.best_negotiation_path.name)} ${money(r.best_negotiation_path.spread)}</div>` : ""}</td>
        <td>${(r.buyer_matches || []).slice(0, 2).map((b) => `${esc(b.name || "buyer")} (${b.score})`).join("<br>") || "none"}</td>
        <td class="muted">${esc([...(r.next_needed || []), ...(r.buyer_gaps || [])].join("; "))}</td>
      </tr>`).join("")
    }</tbody></table>` : `<div class="empty">No records audited yet.</div>`
  }`;
}

async function loadSpreadAudit() {
  const el = $("#spreadAudit");
  if (!el) return;
  try {
    const d = await api("/api/wholesale-spread/audit?limit=1500");
    renderSpreadAudit(d);
  } catch (e) {
    el.innerHTML = `<div class="err-line">${esc(e.message)}</div>`;
  }
}

async function extractSellerPrices() {
  const btn = $("#sellerPriceExtract");
  if (btn) { btn.disabled = true; btn.textContent = "Extracting..."; }
  try {
    const d = await api("/api/seller-price/extract", { method: "POST", body: JSON.stringify({ limit: 2000 }) });
    toast(`Extracted ${d.extracted} seller price evidence item(s)`);
    await loadSpreadAudit();
  } catch (e) {
    toast(e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Extract seller prices"; }
  }
}

function renderEngineRuns(runs) {
  const el = $("#engineHistory");
  if (!el) return;
  if (!runs || !runs.length) {
    el.innerHTML = `<div class="empty">No lead-engine runs yet.</div>`;
    return;
  }
  el.innerHTML = `<table class="src-table"><thead><tr><th>Run</th><th>Target</th><th>Records</th><th>Converged</th><th>Shortlist</th><th>Council</th></tr></thead><tbody>${
    runs.map((r) => `<tr class="engine-run-row" data-run="${r.id}">
      <td><b>#${r.id}</b><div class="muted">${new Date(r.created_at).toLocaleString()}</div></td>
      <td>${esc([r.target?.city, r.target?.state, r.target?.zip].filter(Boolean).join(", ") || JSON.stringify(r.target || {}))}</td>
      <td>${r.raw_records}</td>
      <td>${r.converged_properties}</td>
      <td><b>${r.shortlist_count}</b></td>
      <td>${r.dispatched_council ? '<span class="pill ok">sent</span>' : '<span class="muted">not sent</span>'}</td>
    </tr>`).join("")
  }</tbody></table>`;
  $$("#engineHistory .engine-run-row").forEach((row) => row.addEventListener("click", () => loadEngineCandidates(row.dataset.run)));
}

function renderCouncilJobs(jobs) {
  const el = $("#councilJobs");
  if (!el) return;
  if (!jobs || !jobs.length) {
    el.innerHTML = `<div class="empty">No council review jobs yet.</div>`;
    return;
  }
  const pill = (status) => {
    const ok = status === "dispatched" || status === "responded";
    const err = status === "failed";
    return `<span class="pill ${ok ? "ok" : err ? "err" : ""}">${esc(status || "queued")}</span>`;
  };
  el.innerHTML = `<table class="src-table"><thead><tr><th>Job</th><th>Status</th><th>Target</th><th>Participants</th><th>Packet</th><th>Responses</th><th>Actions</th></tr></thead><tbody>${
    jobs.map((j) => `<tr>
      <td><b>${esc(j.id)}</b><div class="muted">${j.updated_at ? new Date(j.updated_at).toLocaleString() : ""}</div></td>
      <td>${pill(j.status)}</td>
      <td>${esc([j.target?.city, j.target?.state, j.target?.zip].filter(Boolean).join(", ") || JSON.stringify(j.target || {}))}<div class="muted">${j.count || 0} candidate(s)</div></td>
      <td>${esc((j.delivered && j.delivered.length ? j.delivered : j.agents || []).join(", "))}</td>
      <td class="muted">${esc(j.packet || "")}</td>
      <td>${(j.responses || []).length || 0}<div class="muted">${esc(j.error || "")}</div></td>
      <td>
        <button class="btn xs council-sync" data-id="${esc(j.id)}">Sync</button>
        <button class="btn xs council-retry" data-id="${esc(j.id)}">Retry</button>
      </td>
    </tr>`).join("")
  }</tbody></table>`;
  $$("#councilJobs .council-sync").forEach((b) => b.addEventListener("click", () => syncCouncilJob(b.dataset.id)));
  $$("#councilJobs .council-retry").forEach((b) => b.addEventListener("click", () => retryCouncilJob(b.dataset.id)));
}

async function loadCouncilJobs() {
  try {
    const [d, p] = await Promise.all([
      api("/api/council/jobs?limit=20"),
      api("/api/council/participants"),
    ]);
    const meta = $("#councilParticipantsMeta");
    if (meta) meta.textContent = `${(p.participants || []).length} participant(s) available`;
    renderCouncilJobs(d.jobs || []);
  } catch (e) {
    const el = $("#councilJobs");
    if (el) el.innerHTML = `<div class="err-line">${esc(e.message)}</div>`;
  }
}

async function syncCouncilJob(id) {
  try {
    const d = await api(`/api/council/jobs/${encodeURIComponent(id)}/sync`, { method: "POST" });
    toast((d.job.responses || []).length ? "Council response synced" : "No council response found yet");
    loadCouncilJobs();
  } catch (e) { toast(e.message, true); }
}

async function retryCouncilJob(id) {
  try {
    await api(`/api/council/jobs/${encodeURIComponent(id)}/retry`, { method: "POST" });
    toast("Council job re-dispatched");
    loadCouncilJobs();
  } catch (e) { toast(e.message, true); }
}

async function loadEngineHistory() {
  try {
    const d = await api("/api/lead-engine/runs");
    renderEngineRuns(d.runs || []);
  } catch (e) {
    const el = $("#engineHistory");
    if (el) el.innerHTML = `<div class="err-line">${esc(e.message)}</div>`;
  }
}

async function loadLeadEngineSettings() {
  const status = $("#engineAutoStatus");
  if (!status) return;
  try {
    const s = await api("/api/lead-engine/settings");
    $("#engineAutoCity").value = s.city || "";
    $("#engineAutoState").value = s.state || "";
    $("#engineAutoZip").value = s.zip || "";
    $("#engineAutoHours").value = s.autoHours ?? 0;
    $("#engineSourceLimit").value = s.sourceLimit ?? 0;
    $("#engineShortlistLimit").value = s.shortlistLimit ?? 25;
    $("#engineAutoCouncil").checked = Boolean(s.dispatchCouncil);
    if ($("#enginePlan")) {
      if (!searchPlans.length) await loadSearchPlans();
      $("#enginePlan").value = s.planId || "all-enabled";
      loadEcosystemMeta();
    }
    const last = s.lastRun ? new Date(s.lastRun).toLocaleString() : "never";
    const cadence = s.autoHours > 0 ? `every ${s.autoHours}h` : "off";
    status.innerHTML = `Auto-run: <b>${cadence}</b> Â· target: ${esc([s.city, s.state, s.zip].filter(Boolean).join(", ") || "none")} Â· last: ${esc(last)}${s.lastError ? ` <span class="err">Â· ${esc(s.lastError)}</span>` : ""}`;
  } catch (e) {
    status.innerHTML = `<span class="err">${esc(e.message)}</span>`;
  }
}

async function saveLeadEngineSettings() {
  const body = {
    city: $("#engineAutoCity").value.trim(),
    state: $("#engineAutoState").value.trim(),
    zip: $("#engineAutoZip").value.trim(),
    planId: $("#enginePlan") ? $("#enginePlan").value : "all-enabled",
    autoHours: Number($("#engineAutoHours").value || 0),
    sourceLimit: Number($("#engineSourceLimit").value || 0),
    shortlistLimit: Number($("#engineShortlistLimit").value || 25),
    dispatchCouncil: $("#engineAutoCouncil").checked,
  };
  try {
    const s = await api("/api/lead-engine/settings", { method: "POST", body: JSON.stringify(body) });
    toast(s.autoHours > 0 ? "Lead engine auto-run saved" : "Lead engine auto-run off");
    loadLeadEngineSettings();
  } catch (e) { toast(e.message, true); }
}

async function loadEngineCandidates(runId) {
  currentEngineRunId = runId;
  $("#engineStatus").textContent = `Loading candidates for run #${runId}...`;
  try {
    const d = await api(`/api/lead-engine/runs/${runId}/candidates`);
    $("#engineStatus").innerHTML = `<span class="ok">Loaded run #${runId}: ${d.candidates.length} candidate${d.candidates.length === 1 ? "" : "s"}.</span>`;
    renderEngineShortlist((d.candidates || []).map((c) => ({ ...c.data, candidate_id: c.id, status: c.status })));
  } catch (e) {
    $("#engineStatus").innerHTML = `<span class="err">${esc(e.message)}</span>`;
  }
}

async function updateCandidateStatus(id, status) {
  try {
    await api(`/api/lead-engine/candidates/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    toast("Candidate approved for skiptrace");
    if (currentEngineRunId) loadEngineCandidates(currentEngineRunId);
    loadEngineHistory();
  } catch (e) { toast(e.message, true); }
}

async function importEngineCandidate(id) {
  try {
    const r = await api(`/api/lead-engine/candidates/${id}/import`, { method: "POST" });
    toast(r.duplicate ? "Linked to existing lead" : "Imported as prospect");
    loadLeads();
    if (currentEngineRunId) loadEngineCandidates(currentEngineRunId);
    loadEngineHistory();
  } catch (e) { toast(e.message, true); }
}

async function skiptraceEngineCandidate(id) {
  try {
    const r = await api(`/api/lead-engine/candidates/${id}/skiptrace`, { method: "POST" });
    toast(`Skiptraced prospect ${r.leadId}: ${r.phones.length} phone(s)`);
    loadLeads();
    if (currentEngineRunId) loadEngineCandidates(currentEngineRunId);
    loadEngineHistory();
  } catch (e) { toast(e.message, true); }
}

async function runLeadEngine() {
  const city = $("#areaCity").value.trim(), state = $("#areaState").value.trim(), zip = $("#areaZip").value.trim();
  const dispatchCouncil = $("#engineCouncil") && $("#engineCouncil").checked;
  const planId = $("#enginePlan") ? $("#enginePlan").value : "all-enabled";
  if (!city && !zip) { toast("Enter a city or ZIP", true); return; }
  const btn = $("#engineRun"); btn.disabled = true; const label = btn.textContent; btn.textContent = "Converging...";
  $("#engineStatus").textContent = "Running source APIs, converting to Thingas, merging duplicates, analyzing spend candidates...";
  try {
    const d = await api("/api/lead-engine/run", {
      method: "POST",
      body: JSON.stringify({ city, state, zip, planId, dispatchCouncil }),
    });
    const c = d.cycle || {};
    const packet = d.councilDispatch ? ` Council packet: ${d.councilDispatch.packet}` : "";
    $("#engineStatus").innerHTML = `<span class="ok">Run #${d.runId}: converged ${c.raw_records || 0} records into ${c.converged_properties || 0} properties; ${c.shortlist?.length || 0} shortlisted.</span>${packet ? `<span class="muted">${esc(packet)}</span>` : ""}`;
    currentEngineRunId = d.runId;
    renderEngineShortlist(c.shortlist || []);
    loadEngineHistory();
    loadCouncilJobs();
    loadPlanChildren(planId);
    toast(dispatchCouncil ? "Lead engine ran and dispatched council review" : "Lead engine ran");
  } catch (e) {
    $("#engineStatus").innerHTML = `<span class="err">${esc(e.message)}</span>`;
    toast(e.message, true);
  } finally { btn.disabled = false; btn.textContent = label; }
}
document.addEventListener("DOMContentLoaded", () => {
  const p = $("#srcProbe"), r = $("#srcRefresh"), a = $("#areaPull"), e = $("#engineRun"), h = $("#engineHistoryRefresh"), s = $("#engineSaveSettings"), cj = $("#councilJobsRefresh"), plan = $("#enginePlan"), spread = $("#spreadAuditRefresh"), sellerPx = $("#sellerPriceExtract");
  if (p) p.addEventListener("click", probeSources);
  if (r) r.addEventListener("click", loadSources);
  if (a) a.addEventListener("click", pullArea);
  if (e) e.addEventListener("click", runLeadEngine);
  if (h) h.addEventListener("click", loadEngineHistory);
  if (s) s.addEventListener("click", saveLeadEngineSettings);
  if (cj) cj.addEventListener("click", loadCouncilJobs);
  if (spread) spread.addEventListener("click", loadSpreadAudit);
  if (sellerPx) sellerPx.addEventListener("click", extractSellerPrices);
  if (plan) plan.addEventListener("change", () => { loadEcosystemMeta(); loadPlanChildren(plan.value); });
});

// ---------- Populate stage selects ----------
function fillStages() {
  const opts = STAGES.map((s) => `<option value="${s}">${s}</option>`).join("");
  $("#stageSelect").innerHTML = opts;
  $("#stageFilter").innerHTML = `<option value="">All stages</option><option value="__notcontacted">Not contacted</option>` + opts;
}

// ---------- Leads ----------
let leadMode = "active";
async function loadLeads() {
  leads = await api("/api/leads");
  if (leadMode === "active") { fillSources(); renderLeads(); if (leadView === "board") renderBoard(); }
}
// Active = activated working leads; Prospects = pulled records not yet activated.
async function setLeadMode(mode) {
  leadMode = mode;
  $$("#leadModeToggle .seg-btn").forEach((x) => x.classList.toggle("active", x.dataset.mode === mode));
  const prosp = mode === "prospects";
  $("#stageFilter").style.display = prosp ? "none" : "";
  $("#leadSort").style.display = prosp ? "none" : "";
  $("#viewToggle").style.display = prosp ? "none" : "";
  $("#underwriteBtn").style.display = "";
  $("#prospectHint").style.display = prosp ? "" : "none";
  $("#prospectList").style.display = prosp ? "" : "none";
  $("#leadList").style.display = prosp ? "none" : (leadView === "board" ? "none" : "grid");
  $("#leadBoard").style.display = (!prosp && leadView === "board") ? "flex" : "none";
  if (prosp) { prospects = await api("/api/prospects"); fillSources(); renderProspects(); }
  else { fillSources(); renderLeads(); if (leadView === "board") renderBoard(); }
}
function fillSources() {
  const sel = $("#leadSource"); if (!sel) return;
  const data = leadMode === "prospects" ? prospects : leads;
  const blank = leadMode === "prospects" ? "Imported" : "Manually added";
  const counts = {};
  data.forEach((l) => { const s = l.source || blank; counts[s] = (counts[s] || 0) + 1; });
  const cur = sel.value;
  sel.innerHTML = `<option value="">All lists (${data.length})</option>` +
    Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([s, n]) => `<option value="${esc(s)}">${esc(s)} (${n})</option>`).join("");
  sel.value = cur;
}
$$("#leadModeToggle .seg-btn").forEach((b) => b.addEventListener("click", () => setLeadMode(b.dataset.mode)));
const renderCurrentLeadView = () => (leadMode === "prospects" ? renderProspects() : renderLeads());
const CONTACTED_STAGES = ["Contacted", "Follow-Up", "Offer Made", "Backup Offer", "Under Contract", "Assigned", "Closed"];
function renderLeads() {
  const q = $("#leadSearch").value.toLowerCase();
  const sf = $("#stageFilter").value;
  const src = ($("#leadSource") && $("#leadSource").value) || "";
  const sort = ($("#leadSort") && $("#leadSort").value) || "recent";
  let list = leads.filter((l) => {
    if (src && (l.source || "Manually added") !== src) return false;
    if (sf === "__notcontacted") { if (CONTACTED_STAGES.includes(l.stage)) return false; }
    else if (sf && l.stage !== sf) return false;
    if (!q) return true;
    return [l.address, l.seller_name, l.city, l.zip].some((v) => (v || "").toLowerCase().includes(q));
  });
  const cmp = {
    recent: (a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""),
    created: (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
    city: (a, b) => (a.city || "~").localeCompare(b.city || "~") || (a.address || "").localeCompare(b.address || ""),
    state: (a, b) => (a.state || "~").localeCompare(b.state || "~") || (a.city || "").localeCompare(b.city || ""),
  };
  list = [...list].sort(cmp[sort] || cmp.recent);
  const el = $("#leadList");
  if (!list.length) { el.innerHTML = `<div class="empty">No leads match. ${leads.length ? "Try a different filter." : "Click “+ New Lead” to add your first."}</div>`; return; }
  const stageOpts = (cur) => STAGES.map((s) => `<option ${s === cur ? "selected" : ""}>${s}</option>`).join("");
  el.innerHTML = list.map((l) => {
    const meta = [l.seller_name && l.address ? l.seller_name : null, l.seller_phone || null].filter(Boolean).join(" · ");
    const tags = [
      l.next_followup ? `<span class="lc-tag">📅 ${l.next_followup}</span>` : "",
      l.offer_sent_at ? `<span class="lc-tag green">💵 ${l.offer_amount ? money(l.offer_amount) : "Offer sent"}</span>` : (suggestedOffer(l) ? `<span class="lc-tag amber">💵 offer ≤ ${money(suggestedOffer(l))}</span>` : ""),
      l.assignment_fee ? `<span class="lc-tag green">${money(l.assignment_fee)} fee</span>` : "",
    ].filter(Boolean).join("");
    return `
    <div class="lead-card" data-id="${l.id}">
      <div class="main">
        <div class="addr">${esc(l.address || l.seller_name || "Untitled lead")}</div>
        <div class="sub">${esc([l.city, l.state].filter(Boolean).join(", "))}${meta ? " · " + esc(meta) : ""}</div>
        ${tags ? `<div class="lc-tags">${tags}</div>` : ""}
      </div>
      <div class="lc-actions">
        <button class="btn icon offer-btn" data-id="${l.id}" title="Send an offer">💵</button>
        <button class="btn icon followup-btn" data-id="${l.id}" title="Create a follow-up">📅</button>
        <select class="lead-stage-sel badge ${l.stage.replace(/ /g, "-")}" data-id="${l.id}">${stageOpts(l.stage)}</select>
      </div>
    </div>`;
  }).join("");
  $$(".lead-card", el).forEach((c) => c.addEventListener("click", (e) => { if (e.target.closest("select,button")) return; openLead(c.dataset.id); }));
  $$("#leadList .followup-btn").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); createFollowup(b.dataset.id); }));
  $$("#leadList .offer-btn").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openOffer(b.dataset.id); }));
  $$("#leadList .lead-stage-sel").forEach((s) => s.addEventListener("change", async (e) => {
    e.stopPropagation();
    if (s.value === "Closed") { closeWithFee(s.dataset.id); return; } // closing → capture the collected fee
    await api(`/api/leads/${s.dataset.id}/stage`, { method: "PATCH", body: JSON.stringify({ stage: s.value }) });
    toast("Moved to " + s.value);
    loadLeads(); loadDashboard();
  }));
  fillAttachLeads();
}
async function createFollowup(id) {
  const input = prompt("Create a follow-up — in how many days?", "3");
  if (input == null) return;
  const days = parseInt(input, 10);
  if (!days || days < 1) return toast("Enter a number of days", true);
  try {
    const r = await api(`/api/leads/${id}/followup`, { method: "POST", body: JSON.stringify({ days }) });
    toast("Follow-up set for " + r.due);
    loadLeads();
  } catch (e) { toast(e.message, true); }
}
$("#leadSearch").addEventListener("input", () => renderCurrentLeadView());
$("#stageFilter").addEventListener("change", renderLeads);
$("#leadSource")?.addEventListener("change", () => renderCurrentLeadView());
$("#leadSort")?.addEventListener("change", renderLeads);

// --- Kanban board ---
let leadView = "list", dragId = null;
$$("#viewToggle .seg-btn").forEach((b) => b.addEventListener("click", () => {
  leadView = b.dataset.view;
  $$("#viewToggle .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
  const board = leadView === "board";
  $("#leadList").style.display = board ? "none" : "grid";
  $("#leadBoard").style.display = board ? "flex" : "none";
  board ? renderBoard() : renderLeads();
}));
function renderBoard() {
  const board = $("#leadBoard");
  board.innerHTML = STAGES.map((stage) => {
    const cards = leads.filter((l) => l.stage === stage);
    return `<div class="kcol" data-stage="${stage}">
      <div class="kcol-head"><span class="badge ${stage.replace(/ /g, "-")}">${stage}</span><span class="kcount">${cards.length}</span></div>
      <div class="kcards">${cards.map((l) => `
        <div class="kcard" draggable="true" data-id="${l.id}">
          <div class="kc-addr">${esc(l.address || l.seller_name || "Lead #" + l.id)}</div>
          <div class="kc-sub">${esc([l.city, l.state].filter(Boolean).join(", "))}${l.assignment_fee ? ` · <b style="color:var(--green)">${money(l.assignment_fee)}</b>` : ""}</div>
        </div>`).join("")}</div>
    </div>`;
  }).join("");
  $$(".kcard", board).forEach((card) => {
    card.addEventListener("dragstart", () => { dragId = card.dataset.id; card.classList.add("dragging"); });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("click", () => openLead(card.dataset.id));
  });
  $$(".kcol", board).forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", () => col.classList.remove("over"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault(); col.classList.remove("over");
      if (!dragId) return;
      const stage = col.dataset.stage;
      const id = dragId; dragId = null;
      if (stage === "Closed") { closeWithFee(id, renderBoard); return; } // closing → capture the fee
      try {
        await api(`/api/leads/${id}/stage`, { method: "PATCH", body: JSON.stringify({ stage }) });
        await loadLeads();
        renderBoard();
        toast("Moved to " + stage);
      } catch (err) { toast(err.message, true); }
    });
  });
}

// ---------- Lead modal ----------
const leadForm = $("#leadForm");
function openLeadModal() { $("#leadModal").classList.add("open"); }
function closeModal(id) { $("#" + id).classList.remove("open"); }
$$("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest(".modal-bg").classList.remove("open")));
$$(".modal-bg").forEach((bg) => bg.addEventListener("click", (e) => { if (e.target === bg) bg.classList.remove("open"); }));

$("#newLeadBtn").addEventListener("click", () => {
  currentLeadId = null;
  leadForm.reset();
  $("#leadModalTitle").textContent = "New Lead";
  $("#deleteLeadBtn").style.display = "none";
  $("#activityCol").style.display = "none";
  updateMao();
  openLeadModal();
});

async function openLead(id) {
  const lead = await api("/api/leads/" + id);
  currentLeadId = id;
  leadForm.reset();
  for (const k in lead) if (leadForm.elements[k]) leadForm.elements[k].value = lead[k] ?? "";
  $("#leadModalTitle").textContent = lead.address || lead.seller_name || "Lead";
  $("#deleteLeadBtn").style.display = "";
  $("#activityCol").style.display = "";
  currentLeadEmail = lead.seller_email || "";
  // Review toggle reflects current state: active lead → "move to review"; prospect → "activate".
  const rt = $("#reviewToggleBtn");
  if (rt) {
    const isActive = lead.active == null || lead.active == 1;
    rt.dataset.mode = isActive ? "review" : "activate";
    rt.textContent = isActive ? "↩ Move to review" : "✓ Activate lead";
  }
  $("#threadSubject").value = "Following up on " + (lead.address || "your property");
  renderTimeline(lead.activities);
  loadThread(id);
  loadLeadTasks(id);
  updateMao();
  renderLeadData(lead);
  openLeadModal();
}

// Show whatever underwrite / skip-trace data the lead already has.
const parseComps = (lead) => { try { return lead.comps_json ? JSON.parse(lead.comps_json) : null; } catch { return null; } };
function renderLeadData(lead) {
  const el = $("#leadDataResult");
  if (!el) return;
  const bits = [];
  if (lead.uw_at) {
    const eqCls = (lead.equity ?? 0) >= 0 ? "pos" : "neg";
    const comps = parseComps(lead);
    const srcTag = lead.arv_source === "comps"
      ? `<span class="ldr-tag comps">${comps && comps.count ? comps.count + " comps" : "comps"}</span>`
      : `<span class="ldr-tag est">assessed est.</span>`;
    bits.push(`<div class="ldr-row">🧮 <b>ARV ${money(lead.arv)}</b> ${srcTag} · Offer ≤ <b>${money(lead.mao)}</b> · Equity <b class="${eqCls}">${money(lead.equity)}</b>${lead.opportunity_score != null ? ` · Score <b>${lead.opportunity_score}</b>` : ""}</div>`);
    if (comps && comps.comps && comps.comps.length) {
      const rows = comps.comps.slice(0, 4).map((c) => {
        const dt = c.date ? new Date(c.date).toLocaleDateString(undefined, { year: "2-digit", month: "short" }) : "";
        return `<div class="ldc-row"><span>${esc((c.address || "").slice(0, 22))}</span><span>${money(c.price)} · ${c.sqft} sqft · ${dt}</span></div>`;
      }).join("");
      bits.push(`<div class="ldr-comps"><div class="ldc-head">📊 Free live comps — recent nearby sales · median <b>$${comps.medPpsf}/sqft</b></div>${rows}</div>`);
    }
  }
  if (lead.skiptraced_at) {
    bits.push(`<div class="ldr-row">🔎 <b>Skip traced</b> · ${lead.seller_phone ? "📞 " + esc(lead.seller_phone) : "no phone"}${lead.seller_email ? " · ✉ " + esc(lead.seller_email) : ""}</div>`);
  }
  el.innerHTML = bits.join("");
  el.style.display = bits.length ? "block" : "none";
}

$("#underwriteLeadBtn")?.addEventListener("click", async () => {
  if (!currentLeadId) return toast("Save the lead first", true);
  const btn = $("#underwriteLeadBtn"); btn.disabled = true; btn.textContent = "Underwriting…";
  try {
    await api("/api/leads/" + currentLeadId + "/underwrite", { method: "POST" });
    const lead = await api("/api/leads/" + currentLeadId);
    for (const k of ["arv", "repair_estimate"]) if (leadForm.elements[k] && lead[k] != null) leadForm.elements[k].value = lead[k];
    updateMao();
    renderLeadData(lead);
    renderTimeline(lead.activities);
    toast("Underwritten ✅");
    loadLeads();
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = "🧮 Underwrite";
});

$("#skiptraceLeadBtn")?.addEventListener("click", async () => {
  if (!currentLeadId) return toast("Save the lead first", true);
  const btn = $("#skiptraceLeadBtn"); btn.disabled = true; btn.textContent = "Tracing…";
  try {
    const r = await api("/api/leads/" + currentLeadId + "/skiptrace", { method: "POST" });
    const lead = await api("/api/leads/" + currentLeadId);
    if (leadForm.elements.seller_phone) leadForm.elements.seller_phone.value = lead.seller_phone || "";
    if (leadForm.elements.seller_email) leadForm.elements.seller_email.value = lead.seller_email || "";
    renderLeadData(lead);
    renderTimeline(lead.activities);
    toast((r.phones.length || r.emails.length) ? `Found ${r.phones.length} phone(s), ${r.emails.length} email(s) ✅` : "No contact found for this address");
    loadLeads();
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = "🔎 Skip trace $";
});

// --- Lead tasks ---
async function loadLeadTasks(leadId) {
  const el = $("#leadTasks");
  const tasks = await api("/api/leads/" + leadId + "/tasks").catch(() => []);
  el.innerHTML = tasks.length ? tasks.map((t) => `
    <div class="lt ${t.done ? "done" : ""}">
      <input type="checkbox" class="lt-done" data-id="${t.id}" ${t.done ? "checked" : ""} />
      <span class="lt-title">${esc(t.title)}</span>
      ${t.due_date ? `<span class="lt-due">${t.due_date}</span>` : ""}
      <button class="lt-del" data-id="${t.id}" title="Delete">×</button>
    </div>`).join("") : `<div class="empty" style="padding:4px">No tasks yet.</div>`;
  $$("#leadTasks .lt-done").forEach((cb) => cb.addEventListener("change", async () => {
    await api("/api/tasks/" + cb.dataset.id, { method: "PUT", body: JSON.stringify({ done: cb.checked ? 1 : 0 }) });
    loadLeadTasks(leadId);
  }));
  $$("#leadTasks .lt-del").forEach((b) => b.addEventListener("click", async () => {
    await api("/api/tasks/" + b.dataset.id, { method: "DELETE" });
    loadLeadTasks(leadId);
  }));
}
$("#addTaskBtn")?.addEventListener("click", async () => {
  const title = $("#taskTitle").value.trim();
  if (!title) return toast("Enter a task", true);
  if (!currentLeadId) return toast("Save the lead first", true);
  await api("/api/leads/" + currentLeadId + "/tasks", { method: "POST", body: JSON.stringify({ title, due_date: $("#taskDue").value || null }) });
  $("#taskTitle").value = ""; $("#taskDue").value = "";
  toast("Task added"); loadLeadTasks(currentLeadId);
});
$("#taskTitle")?.addEventListener("keydown", (e) => { if (e.key === "Enter") $("#addTaskBtn").click(); });

function formData(form) {
  const d = {};
  new FormData(form).forEach((v, k) => (d[k] = v));
  return d;
}

let leadSubmitting = false;
leadForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (leadSubmitting) return; // ignore double-clicks while the (slower, comps-loading) save is in flight
  leadSubmitting = true;
  const saveBtn = leadForm.querySelector('button[type="submit"]');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = currentLeadId ? "Saving…" : "Adding & pulling comps…"; }
  const d = formData(leadForm);
  try {
    if (currentLeadId) {
      await api("/api/leads/" + currentLeadId, { method: "PUT", body: JSON.stringify(d) });
      toast("Lead saved");
      const lead = await api("/api/leads/" + currentLeadId);
      renderTimeline(lead.activities);
      await loadLeads();
    } else {
      const res = await api("/api/leads", { method: "POST", body: JSON.stringify(d) });
      await loadLeads();
      toast(res.underwrite ? "Lead created — comps & ARV auto-loaded ✅" : "Lead created");
      await openLead(res.id); // reopen so the pre-loaded comps/underwrite show
    }
  } catch (err) { toast(err.message, true); }
  finally {
    leadSubmitting = false;
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save"; }
  }
});

$("#deleteLeadBtn").addEventListener("click", async () => {
  if (!confirm("Delete this lead and its history?")) return;
  await api("/api/leads/" + currentLeadId, { method: "DELETE" });
  closeModal("leadModal");
  toast("Lead deleted");
  loadLeads();
});

// MAO calculator: 70% ARV - repairs - assignment fee
function updateMao() {
  const arv = parseFloat(leadForm.elements.arv.value) || 0;
  const repairs = parseFloat(leadForm.elements.repair_estimate.value) || 0;
  const fee = parseFloat(leadForm.elements.assignment_fee.value) || 0;
  const box = $("#maoBox");
  if (!arv) { box.className = "mao-box empty"; return; }
  const mao70 = arv * 0.7 - repairs - fee;
  const mao75 = arv * 0.75 - repairs - fee;
  box.className = "mao-box";
  box.innerHTML = `Suggested max offer (MAO): <b>${money(Math.round(mao70))}</b> @70% &nbsp;·&nbsp; <b>${money(Math.round(mao75))}</b> @75% &nbsp;<span style="color:var(--muted)">(ARV − repairs − fee)</span>`;
}
["arv", "repair_estimate", "assignment_fee"].forEach((n) =>
  leadForm.elements[n].addEventListener("input", updateMao)
);

// ---------- Timeline ----------
const ICON = { note: "📝", call: "📞", email: "📧", stage_change: "🔄", sms: "💬" };
function renderTimeline(acts) {
  const el = $("#timeline");
  if (!acts || !acts.length) { el.innerHTML = `<div class="empty">No activity yet.</div>`; return; }
  el.innerHTML = acts.map((a) => `
    <div class="tl">
      <div class="tl-head"><span>${ICON[a.type] || "•"} ${a.type.replace("_", " ")}</span>
        <span>${new Date(a.created_at).toLocaleString()}</span></div>
      <div class="tl-body">${(a.body || "").replace(/</g, "&lt;")}</div>
    </div>`).join("");
}
async function addActivity(type, body) {
  await api(`/api/leads/${currentLeadId}/activities`, { method: "POST", body: JSON.stringify({ type, body }) });
  const lead = await api("/api/leads/" + currentLeadId);
  renderTimeline(lead.activities);
  loadLeads();
}

$("#logCallBtn").addEventListener("click", () => {
  const note = prompt("Call notes:");
  if (note) addActivity("call", note).then(() => toast("Call logged"));
});
$("#addNoteBtn").addEventListener("click", () => {
  const note = prompt("Note:");
  if (note) addActivity("note", note).then(() => toast("Note added"));
});

// ----- Conversation thread (two-way email per lead) -----
let currentLeadEmail = "";
async function loadThread(id) {
  const el = $("#leadThread");
  if (!el) return;
  el.innerHTML = `<div class="empty" style="padding:6px">Loading…</div>`;
  try {
    const d = await api(`/api/leads/${id}/thread`);
    renderThread(d.messages || []);
  } catch { el.innerHTML = `<div class="empty" style="padding:6px">No messages yet.</div>`; }
}
function renderThread(msgs) {
  const el = $("#leadThread");
  if (!el) return;
  if (!msgs.length) { el.innerHTML = `<div class="empty" style="padding:6px">No emails yet. Send the first message below.</div>`; return; }
  el.innerHTML = msgs.map((m) => {
    const out = m.direction === "out";
    const when = m.msg_date ? new Date(m.msg_date).toLocaleString() : "";
    return `<div class="bubble ${out ? "out" : "in"}">
      <div class="bb-head">${out ? "You" : esc(m.from_name || m.from_addr || "Them")} · <span class="bb-when">${when}</span></div>
      ${m.subject ? `<div class="bb-subj">${esc(m.subject)}</div>` : ""}
      <div class="bb-body">${esc(m.body || m.snippet || "").replace(/\n/g, "<br>")}</div>
    </div>`;
  }).join("");
  el.scrollTop = el.scrollHeight;
}
$("#threadSendBtn")?.addEventListener("click", async () => {
  if (!currentLeadId) return toast("Save the lead first", true);
  const to = currentLeadEmail || leadForm.elements.seller_email.value;
  if (!to) return toast("This lead has no email. Skip trace it first.", true);
  if (!settings.emailConfigured) return toast("Connect your Gmail in Outreach first", true);
  const subject = $("#threadSubject").value.trim() || "Following up on your property";
  const body = $("#threadBody").value.trim();
  if (!body) return toast("Write a message", true);
  const btn = $("#threadSendBtn"); btn.disabled = true; btn.textContent = "Sending…";
  try {
    await api(`/api/leads/${currentLeadId}/email`, { method: "POST", body: JSON.stringify({ to, subject, body }) });
    $("#threadBody").value = "";
    toast("Sent ✅");
    loadThread(currentLeadId);
    const lead = await api("/api/leads/" + currentLeadId);
    renderTimeline(lead.activities);
  } catch (err) { toast(err.message, true); }
  btn.disabled = false; btn.textContent = "Send ✉";
});
// Move a lead between Active and the review queue.
$("#reviewToggleBtn")?.addEventListener("click", async () => {
  if (!currentLeadId) return;
  const toReview = $("#reviewToggleBtn").dataset.mode !== "activate";
  try {
    await api(`/api/leads/${currentLeadId}/triage`, { method: "PATCH", body: JSON.stringify({ action: toReview ? "review" : "activate" }) });
    toast(toReview ? "Moved to review queue" : "Activated as a working lead ✅");
    closeModal("leadModal");
    leads = await api("/api/leads"); prospects = await api("/api/prospects");
    fillSources(); renderCurrentLeadView(); loadDashboard();
  } catch (e) { toast(e.message, true); }
});


// ---------- Dashboard ----------
async function loadDashboard() {
  const s = await api("/api/stats");
  const tasks = await api("/api/tasks").catch(() => []);
  const active = s.totals.total || 0;
  const ot = s.offersToday ?? 0, tgt = s.offersTarget ?? 5;
  const hit = ot >= tgt;
  const C = 2 * Math.PI * 34;
  const off = (C * (1 - Math.min(1, tgt ? ot / tgt : 0))).toFixed(1);
  $("#statCards").innerHTML = `
    <div class="card kpi ${hit ? "kpi-hit" : ""}">
      <div class="kpi-ring">
        <svg viewBox="0 0 80 80"><circle class="kpi-track" cx="40" cy="40" r="34"></circle>
          <circle class="kpi-prog" cx="40" cy="40" r="34" style="stroke-dasharray:${C.toFixed(1)};stroke-dashoffset:${off}"></circle></svg>
        <div class="kpi-num">${ot}<span>/${tgt}</span></div>
      </div>
      <div class="lbl">🎯 Offers sent today ${hit ? "🔥" : ""}<br><span class="hint">resets 9am ET</span></div>
    </div>
    <div class="card"><div class="big">${active}</div><div class="lbl">Active leads</div></div>
    <div class="card"><div class="big">${money(s.totals.pipeline_fees)}</div><div class="lbl">Projected fees (pipeline)</div><div class="sub" style="color:var(--green);font-size:13px;margin-top:4px">${money(s.totals.collected_fees || 0)} collected</div></div>
    <div class="card"><div class="big">${s.prospects || 0}</div><div class="lbl">Prospects to review</div></div>`;
  // Active-lead breakdown by stage (clickable → filters the Leads tab)
  const counts = {};
  s.stages.forEach((x) => (counts[x.stage] = x.n));
  const KEY = ["New", "Contacted", "Follow-Up", "Offer Made", "Backup Offer", "Under Contract", "Assigned"];
  $("#stageCards").innerHTML = KEY.map((st) =>
    `<div class="stage-card s-${st.replace(/ /g, "-")}" data-stage="${st}"><div class="sc-n">${counts[st] || 0}</div><div class="sc-l">${st}</div></div>`
  ).join("");
  $$("#stageCards .stage-card").forEach((c) => c.addEventListener("click", () => {
    $('[data-tab="leads"]').click();
    setLeadMode("active");
    $("#stageFilter").value = c.dataset.stage;
    renderLeads();
  }));
  const fu = $("#followups");
  const taskHtml = tasks.map((t) => {
    const overdue = t.due_date && t.due_date < s.today;
    const who = t.address || t.seller_name || (t.lead_id ? "Lead #" + t.lead_id : "General");
    return `<div class="fu task ${overdue ? "overdue" : ""}">
      <span><input type="checkbox" class="task-done" data-id="${t.id}" /> 📋 ${esc(t.title)} ${t.lead_id ? `<span class="open-lead hint" data-id="${t.lead_id}">${esc(who)}</span>` : `<span class="hint">${esc(who)}</span>`}</span>
      <span class="when">${t.due_date ? (overdue ? "Overdue · " : "") + t.due_date : ""}</span></div>`;
  }).join("");
  const fuHtml = s.followups.map((f) => {
    const overdue = f.next_followup < s.today;
    return `<div class="fu ${overdue ? "overdue" : ""}"><span class="open-lead" data-id="${f.id}">⏰ ${f.address || f.seller_name || "Lead"} <span class="badge ${f.stage.replace(/ /g, "-")}">${f.stage}</span></span>
      <span class="when">${overdue ? "Overdue · " : ""}${f.next_followup}</span></div>`;
  }).join("");
  // Property call follow-ups (recorded on the Fill tab) — click jumps to the queue.
  const cfHtml = (s.callFollowups || []).map((f) => {
    const overdue = f.follow_up_date < s.today;
    return `<div class="fu ${overdue ? "overdue" : ""}"><span class="open-fill" style="cursor:pointer">📞 ${esc(f.formatted_address || f.address || ("Property #" + f.property_id))} <span class="hint">${esc(f.outcome.replace(/_/g, " "))}</span></span>
      <span class="when">${overdue ? "Overdue · " : ""}${f.follow_up_date}</span></div>`;
  }).join("");
  fu.innerHTML = (taskHtml + fuHtml + cfHtml) || `<div class="empty">Nothing due. 🎉</div>`;
  $$(".open-fill", fu).forEach((c) => c.addEventListener("click", () => $('[data-tab="fill"]').click()));
  $$(".task-done", fu).forEach((cb) => cb.addEventListener("change", async () => {
    await api("/api/tasks/" + cb.dataset.id, { method: "PUT", body: JSON.stringify({ done: 1 }) });
    toast("Task done ✅"); loadDashboard();
  }));
  $$(".open-lead", fu).forEach((c) => c.addEventListener("click", () => {
    $('[data-tab="leads"]').click(); openLead(c.dataset.id);
  }));
  const max = Math.max(1, ...s.stages.map((x) => x.n));
  $("#pipelineBars").innerHTML = STAGES.map((name) => {
    const row = s.stages.find((x) => x.stage === name);
    const n = row ? row.n : 0;
    return `<div class="pb"><span class="name">${name}</span>
      <div class="bar" style="width:${(n / max) * 100}%"></div><span class="cnt">${n}</span></div>`;
  }).join("");
  // Calendar markers from follow-ups + dated tasks
  calItems = {};
  const addCal = (date, label) => { if (!date) return; (calItems[date] = calItems[date] || []).push(label); };
  s.followups.forEach((f) => addCal(f.next_followup, "⏰ " + (f.address || f.seller_name || "Follow-up")));
  (s.callFollowups || []).forEach((f) => addCal(f.follow_up_date, "📞 " + (f.formatted_address || f.address || "Call follow-up")));
  tasks.forEach((t) => addCal(t.due_date, "📋 " + t.title));
  await loadDayNotes();
  loadDashMessages();
  loadBackupInfo();
  loadNextAction(s);
}

// 🎯 The single next money action, derived from live state (docs/OPERATOR_ACTIONS.md order).
async function loadNextAction(stats) {
  const panel = $("#nextActionPanel"), body = $("#nextActionBody");
  if (!panel || !body) return;
  try {
    const due = (stats.callFollowups || []).length;
    let cov = null;
    try { cov = await api("/api/pipeline/coverage"); } catch { /* no build yet */ }
    const ptu = cov?.tiers?.pay_to_unlock || 0;
    const callNow = cov?.tiers?.call_now || 0;
    let msg;
    if (due > 0) msg = `<b>${due} call follow-up${due === 1 ? "" : "s"} due</b> — dial from the queue (Outcome column records the result).`;
    else if (callNow > 0) msg = `<b>${callNow} call-now lead${callNow === 1 ? "" : "s"} ready</b> — pull the ⬇ Call sheet and dial.`;
    else if (ptu > 0) msg = `<b>${ptu.toLocaleString()} leads are one skip-trace from callable</b> — fund a provider and run the pursuable export (docs/OPERATOR_ACTIONS.md #1).`;
    else msg = `Run the ⚡ Fill pipeline to build the queue.`;
    body.innerHTML = msg;
    panel.style.display = "";
  } catch { panel.style.display = "none"; }
}

// ----- Dashboard: recent messages panel -----
async function loadDashMessages() {
  const el = $("#dashMessages");
  if (!el) return;
  try {
    const d = await api("/api/emails/recent");
    const msgs = d.messages || [];
    if (!msgs.length) { el.innerHTML = `<div class="empty" style="padding:6px">No lead conversations yet. Emails to/from your leads show up here.</div>`; return; }
    el.innerHTML = msgs.map((m) => {
      const out = m.direction === "out";
      const who = out ? "To " + (m.leadName || m.toAddr || "") : (m.fromName || m.fromEmail || "Unknown");
      return `<div class="dmsg ${m.read || out ? "" : "unread"}" ${m.leadId ? `data-lead="${m.leadId}"` : `data-inbox="1"`}>
        <div class="dmsg-ico">${out ? "↗" : "↘"}</div>
        <div class="dmsg-main">
          <div class="dmsg-top"><span class="dmsg-who">${esc(who)}</span><span class="dmsg-when">${timeAgo(m.date)}</span></div>
          <div class="dmsg-sub">${esc(m.subject || "(no subject)")}</div>
          <div class="dmsg-snip">${esc(m.snippet || "")}</div>
        </div>
      </div>`;
    }).join("");
    $$("#dashMessages .dmsg[data-lead]").forEach((c) => c.addEventListener("click", () => { $('[data-tab="leads"]').click(); openLead(c.dataset.lead); }));
    $$("#dashMessages .dmsg[data-inbox]").forEach((c) => c.addEventListener("click", () => $('[data-tab="inbox"]').click()));
  } catch { el.innerHTML = `<div class="empty" style="padding:6px">Couldn't load messages.</div>`; }
}

// ----- Dashboard: mini calendar + daily notes -----
const todayLocal = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
let calItems = {}, calRef = new Date(), calNotes = {}, calSelected = todayLocal();
async function loadDayNotes() {
  try {
    const rows = await api("/api/day-notes");
    calNotes = {};
    rows.forEach((r) => (calNotes[r.day] = r.body));
  } catch { calNotes = {}; }
  renderCalendar();
  selectDay(calSelected, false);
  renderNoteList();
}
function renderCalendar() {
  const el = $("#dashCalendar");
  if (!el) return;
  const y = calRef.getFullYear(), mo = calRef.getMonth();
  const startDow = new Date(y, mo, 1).getDay();
  const daysIn = new Date(y, mo + 1, 0).getDate();
  const todayStr = todayLocal();
  $("#calLabel").textContent = calRef.toLocaleString("en-US", { month: "long", year: "numeric" });
  let cells = ["S", "M", "T", "W", "T", "F", "S"].map((d) => `<div class="cal-dow">${d}</div>`);
  for (let i = 0; i < startDow; i++) cells.push(`<div class="cal-cell empty"></div>`);
  for (let d = 1; d <= daysIn; d++) {
    const ds = `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const items = calItems[ds] || [];
    const note = calNotes[ds];
    const tip = [...items, note ? "📝 " + note.slice(0, 60) : ""].filter(Boolean).join("\n");
    const cls = ["cal-cell", ds === todayStr ? "today" : "", ds === calSelected ? "sel" : "", items.length ? "has" : "", note ? "noted" : ""].filter(Boolean).join(" ");
    cells.push(`<div class="${cls}" data-day="${ds}" ${tip ? `title="${esc(tip)}"` : ""}>${d}${items.length ? `<span class="cal-dot">${items.length}</span>` : ""}${note ? `<span class="cal-note-dot"></span>` : ""}</div>`);
  }
  el.innerHTML = `<div class="cal-grid">${cells.join("")}</div>`;
  $$("#dashCalendar .cal-cell[data-day]").forEach((c) => c.addEventListener("click", () => selectDay(c.dataset.day, true)));
}
function prettyDay(ds) {
  const [y, m, d] = ds.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const today = todayLocal();
  const label = dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (ds === today) return "Today · " + label;
  if (ds < today) return "Past · " + label;
  return "Upcoming · " + label;
}
function selectDay(ds, jumpMonth) {
  calSelected = ds;
  if (jumpMonth) {
    const [y, m] = ds.split("-").map(Number);
    if (calRef.getFullYear() !== y || calRef.getMonth() !== m - 1) calRef = new Date(y, m - 1, 1);
  }
  $("#noteDayLabel").textContent = prettyDay(ds);
  $("#noteBody").value = calNotes[ds] || "";
  renderCalendar();
}
async function saveDayNote() {
  const body = $("#noteBody").value;
  try {
    await api("/api/day-notes/" + calSelected, { method: "PUT", body: JSON.stringify({ body }) });
    if (body.trim()) calNotes[calSelected] = body.trim(); else delete calNotes[calSelected];
    toast("Note saved ✅");
    renderCalendar(); renderNoteList();
  } catch (e) { toast(e.message, true); }
}
function renderNoteList() {
  const el = $("#noteList");
  if (!el) return;
  const days = Object.keys(calNotes).sort();
  if (!days.length) { el.innerHTML = `<div class="empty" style="padding:4px;font-size:12px">No notes yet. Click any day and jot one down.</div>`; return; }
  const today = todayLocal();
  el.innerHTML = days.map((ds) => {
    const when = ds === today ? "today" : ds < today ? "past" : "future";
    return `<div class="note-item ${when} ${ds === calSelected ? "sel" : ""}" data-day="${ds}">
      <span class="ni-date">${prettyDay(ds).replace(/^(Today|Past|Upcoming) · /, "")}</span>
      <span class="ni-body">${esc(calNotes[ds])}</span>
    </div>`;
  }).join("");
  $$("#noteList .note-item").forEach((c) => c.addEventListener("click", () => selectDay(c.dataset.day, true)));
}
$("#noteSaveBtn")?.addEventListener("click", saveDayNote);
$("#calPrev")?.addEventListener("click", () => { calRef = new Date(calRef.getFullYear(), calRef.getMonth() - 1, 1); renderCalendar(); });
$("#calNext")?.addEventListener("click", () => { calRef = new Date(calRef.getFullYear(), calRef.getMonth() + 1, 1); renderCalendar(); });
$$("[data-tab-jump]").forEach((b) => b.addEventListener("click", () => $(`[data-tab="${b.dataset.tabJump}"]`).click()));
async function loadBackupInfo() {
  try {
    const b = await api("/api/backup/status");
    const when = b.last ? new Date(b.last).toLocaleString() : "—";
    $("#backupInfo").innerHTML = `Auto-backups run every 6 hours &amp; on startup — <b>${b.count}</b> snapshots saved · last: ${when}. Your data lives in <code>crm.db</code>; even if the app stops, nothing is lost.`;
  } catch { $("#backupInfo").textContent = ""; }
}
$("#backupNowBtn")?.addEventListener("click", async () => {
  try { await api("/api/backup", { method: "POST" }); toast("Backup saved ✅"); loadBackupInfo(); }
  catch (e) { toast(e.message, true); }
});

// ---------- Deal Calculator (Creative Offer Oven) ----------
function calcGet(k) {
  const el = document.querySelector(`.ci[data-k="${k}"]`);
  if (!el) return 0;
  if (el.type === "checkbox") return el.checked;
  return parseFloat(el.value) || 0;
}
function pmt(principal, annualRatePct, years, interestOnly) {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (interestOnly) return principal * r;
  if (r === 0) return n ? principal / n : 0;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}
let offerType = "subto";
const OT_HINTS = {
  cash: "Cash offer (traditional wholesale): you lock the property up cheap and assign it to a cash buyer. The MAO is the most you should offer — ARV × your % minus repairs minus your wholesale fee. The rent metrics show your cash buyer whether it cash-flows as a rental.",
  subto: "Subject-To: you take over the seller's existing mortgage(s) — the loan stays in their name and you make the payments. Little or no new financing. It doesn't have to cash flow huge to win, because you also get the loan paydown and appreciation.",
  sellerfinance: "Seller Finance: the seller becomes the bank and creates a new note. You agree on price, down, rate, and amortization. Works best when the home is owned free-and-clear.",
  hybrid: "Hybrid: you take over the existing loan(s) Subject-To AND the seller finances the leftover equity as a second note. Fill in both the Subject-To and Seller-Financed Note sections.",
};
function applyOfferType() {
  const cash = offerType === "cash";
  $$(".offer-type .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.ot === offerType));
  $("#fsCash").style.display = cash ? "block" : "none";
  $("#fsSubto").style.display = (offerType === "subto" || offerType === "hybrid") ? "block" : "none";
  $("#fsSF").style.display = (offerType === "sellerfinance" || offerType === "hybrid") ? "block" : "none";
  $("#fldDown").style.display = cash ? "none" : "block";
  $$(".r-cash").forEach((c) => (c.style.display = cash ? "block" : "none"));
  $$(".r-finance").forEach((c) => (c.style.display = cash ? "none" : "block"));
  $("#lblPurchase").textContent = cash ? "Your Cash Offer" : "Purchase Price";
  $("#otHint").textContent = OT_HINTS[offerType];
}

// Reset all calculator inputs to their default values.
$("#resetCalc").addEventListener("click", () => {
  $$(".ci").forEach((el) => {
    if (el.type === "checkbox") el.checked = el.defaultChecked;
    else el.value = el.defaultValue;
  });
  runDealCalc();
  renderSchedule();
  toast("Calculator reset");
});
$$(".offer-type .seg-btn").forEach((b) =>
  b.addEventListener("click", () => { offerType = b.dataset.ot; applyOfferType(); runDealCalc(); renderSchedule(); })
);

let lastDeal = null;
const $v = (id, v) => { const el = $("#" + id); if (el) el.textContent = v; };

// Standard rental underwriting: rent → vacancy → operating expenses → NOI → debt → cash flow.
function rentalModel(debtMonthly) {
  const g = calcGet;
  const rent = g("rent");
  const vacLoss = g("vac") / 100 * rent;
  const egi = rent - vacLoss;                     // effective gross income
  const mgmt = g("mgmt") / 100 * rent;
  const maint = g("maint") / 100 * rent;
  const capex = g("capex") / 100 * rent;
  const tax = g("tax"), ins = g("ins"), hoa = g("hoa"), other = g("other");
  const opex = tax + ins + hoa + other + mgmt + maint + capex;
  const noiMo = egi - opex;                        // net operating income (before debt)
  const cashflowMo = noiMo - debtMonthly;
  return { rent, vacLoss, egi, tax, ins, hoa, other, mgmt, maint, capex, opex, noiMo, cashflowMo, debtMonthly };
}
function renderCashflowBreakdown(m, metrics) {
  const r = (lbl, val, neg) => `<div class="cfb-row"><span>${lbl}</span><span class="${neg ? "neg" : ""}">${neg ? "− " : ""}${money(Math.round(Math.abs(val)))}</span></div>`;
  let h = r("Gross rent", m.rent);
  if (m.vacLoss) h += r(`Vacancy (${calcGet("vac")}%)`, m.vacLoss, true);
  h += `<div class="cfb-row sub"><span>Effective income</span><span>${money(Math.round(m.egi))}</span></div>`;
  if (m.tax) h += r("Property tax", m.tax, true);
  if (m.ins) h += r("Insurance", m.ins, true);
  if (m.hoa) h += r("HOA", m.hoa, true);
  if (m.other) h += r("Other", m.other, true);
  if (m.mgmt) h += r(`Management (${calcGet("mgmt")}%)`, m.mgmt, true);
  if (m.maint) h += r(`Maintenance (${calcGet("maint")}%)`, m.maint, true);
  if (m.capex) h += r(`CapEx reserve (${calcGet("capex")}%)`, m.capex, true);
  h += `<div class="cfb-row sub"><span>NOI (before debt)</span><span>${money(Math.round(m.noiMo))}/mo</span></div>`;
  if (m.debtMonthly) h += r("Debt service", m.debtMonthly, true);
  h += `<div class="cfb-row total"><span>Monthly cash flow</span><span class="${m.cashflowMo >= 0 ? "pos" : "neg"}">${money(Math.round(m.cashflowMo))}/mo</span></div>`;
  const tgt = metrics.target || 0;
  const cocPass = tgt ? metrics.coc >= tgt : metrics.coc >= 0;
  const met = `<div class="cfb-metrics">
    <span>Cap rate<b>${metrics.cap.toFixed(1)}%</b></span>
    <span>Cash-on-cash${tgt ? ` <small>≥${tgt.toFixed(1)}%</small>` : ""}<b class="${cocPass ? "pos" : "neg"}">${metrics.coc.toFixed(1)}% ${tgt ? (cocPass ? "✓" : "✗") : ""}</b></span>
    <span>DSCR<b>${metrics.dscr == null ? "—" : metrics.dscr.toFixed(2)}</b></span>
  </div>`;
  $("#cfBreakdown").innerHTML = `<div class="cfb-title">💵 Cash-flow breakdown <span class="hint">(monthly)</span></div>${h}${met}`;
}

function runCashCalc() {
  const g = calcGet;
  const arv = g("arv"), repairs = g("repairs"), maoPct = g("maoPct"), wfee = g("wfee");
  const offer = g("purchase"), closing = g("closing");
  const target = g("cocTarget") || 14.7; // minimum cash-on-cash % to gate the offer

  // The cash buyer pays your offer PLUS your wholesale fee to take the assignment.
  const buyerPrice = offer + wfee;
  const m = rentalModel(0); // cash purchase: no debt service
  const rent = m.rent;
  const cashflowMo = m.cashflowMo;
  const noiAnnual = m.noiMo * 12;
  const cashInvested = buyerPrice + repairs + closing; // buyer's all-in (incl. your fee)
  const capRate = buyerPrice ? noiAnnual / buyerPrice * 100 : 0;
  const cocCash = cashInvested ? (cashflowMo * 12) / cashInvested * 100 : 0;
  const onePct = buyerPrice ? rent / buyerPrice * 100 : 0;

  // Two MAO ceilings — take the LOWER so the deal clears BOTH the ARV rule and the cash-on-cash floor.
  const maoArv = arv * maoPct / 100 - repairs - wfee;
  // All-cash CoC = annual cashflow ÷ (offer + fee + repairs + closing). Solve for offer at target CoC:
  const maxAllIn = target > 0 ? (cashflowMo * 12) / (target / 100) : Infinity;
  const maoCashflow = cashflowMo > 0 ? maxAllIn - wfee - repairs - closing : -Infinity;
  const cashBound = maoCashflow < maoArv;
  const recMao = Math.min(maoArv, maoCashflow);
  const margin = recMao - offer; // positive = your offer is under the recommended ceiling
  renderCashflowBreakdown(m, { cap: capRate, coc: cocCash, dscr: null, target });

  $("#heroLbl").textContent = "Monthly Cash Flow (rental)";
  $v("rCashflowMo", money(Math.round(cashflowMo)) + "/mo");
  $v("rCashflowYr", money(Math.round(cashflowMo * 12)) + " / yr");
  $v("rMao", isFinite(recMao) ? money(Math.round(recMao)) : "—");
  $v("rMaoCf", isFinite(maoCashflow) ? money(Math.round(maoCashflow)) : "needs cashflow");
  $v("rMaoArv", money(Math.round(maoArv)));
  $$(".cocTgt").forEach((el) => (el.textContent = target.toFixed(1) + "%"));
  $("#maoDriver").textContent = cashBound ? "cashflow-bound" : "ARV-bound";
  $v("rMargin", (margin >= 0 ? "" : "-") + money(Math.abs(Math.round(margin))) + (margin >= 0 ? " under" : " OVER"));
  $v("rCap", capRate.toFixed(1) + "%");
  $v("rCocCash", cocCash.toFixed(1) + "%");
  $v("r1pct", onePct.toFixed(2) + "%");
  $v("rCashInv", money(Math.round(cashInvested)));
  $("#maoLine").innerHTML = `ARV rule: <b>${money(Math.round(maoArv))}</b> &nbsp;·&nbsp; ${target.toFixed(1)}% CoC ceiling: <b>${money(Math.round(maoCashflow))}</b><br><b>Pay no more than ${isFinite(recMao) ? money(Math.round(recMao)) : "—"}</b> (the lower — ${cashBound ? "cashflow is the limiter" : "ARV is the limiter"}). Your fee: <b style="color:var(--green)">${money(wfee)}</b>.`;
  $("#rCashflowMo").style.color = cashflowMo >= 0 ? "var(--green)" : "var(--red)";
  $("#rMargin").style.color = margin >= 0 ? "var(--green)" : "var(--red)";
  $("#rCocCash").style.color = cocCash >= target ? "var(--green)" : "var(--red)";
  $("#rMao").style.color = "var(--green)";

  lastDeal = { offerType: "Cash", offer, arv, repairs, maoPct, wfee, mao: recMao, maoArv, maoCashflow, margin, buyerPrice, capRate, cocCash, target, onePct, cashInvested, cashflowMo, rent };
}

function runDealCalc() {
  if (offerType === "cash") return runCashCalc();
  $("#heroLbl").textContent = "Monthly Cash Flow";
  const g = calcGet;
  const purchase = g("purchase"), down = g("down");
  const subtoBal = g("sb1") + g("sb2");
  const subtoMonthly = g("sp1") + g("sp2");
  const usesSubto = offerType !== "sellerfinance";
  const usesSF = offerType !== "subto";
  let sfLoan = 0;
  if (offerType === "sellerfinance") sfLoan = Math.max(0, purchase - down);
  else if (offerType === "hybrid") sfLoan = Math.max(0, purchase - down - subtoBal);
  const rate = g("rate"), amort = g("amort"), io = g("io");
  const sfPmt = sfLoan > 0 ? pmt(sfLoan, rate, amort, io) : 0;
  const monthlyPmt = (usesSubto ? subtoMonthly : 0) + (usesSF ? sfPmt : 0);
  const totalLoan = (usesSubto ? subtoBal : 0) + (usesSF ? sfLoan : 0);

  const m = rentalModel(monthlyPmt);
  const opexNoDebt = m.opex;
  const cashflowMo = m.cashflowMo;
  const noiAnnual = m.noiMo * 12;

  const target = g("cocTarget") || 14.7;
  const cashIn = g("entry") + down + g("rehab") + g("assign") + g("closing");
  // Honest cash-on-cash: annual cashflow ÷ total cash invested (subto equity is thin, so the return must come from cashflow).
  const coc = cashIn ? (cashflowMo * 12) / cashIn * 100 : 0;
  // The lever in a takeover is cash to seller (down). Max down that still clears the CoC floor:
  const cashOps = g("entry") + g("rehab") + g("assign") + g("closing");
  const maxCashIn = target > 0 ? (cashflowMo * 12) / (target / 100) : Infinity;
  const maxDown = cashflowMo > 0 ? maxCashIn - cashOps : -Infinity;
  const capRate = purchase ? noiAnnual / purchase * 100 : 0;
  const dscr = monthlyPmt ? m.noiMo / monthlyPmt : null;
  const commission = purchase * g("comm") / 100;
  const cashToSeller = down - commission;
  const future = g("listed") * Math.pow(1 + g("appr") / 100, g("apprYrs"));
  renderCashflowBreakdown(m, { cap: capRate, coc, dscr, target });

  $$(".cocTgt").forEach((el) => (el.textContent = target.toFixed(1) + "%"));
  $v("rCashflowMo", money(Math.round(cashflowMo)) + "/mo");
  $v("rCashflowYr", money(Math.round(cashflowMo * 12)) + " / yr");
  $v("rPmt", money(Math.round(monthlyPmt)) + "/mo");
  $v("rCoc", coc.toFixed(1) + "%");
  $v("rMaxDown", (cashflowMo > 0 && isFinite(maxDown)) ? money(Math.round(maxDown)) : "needs cashflow");
  $v("rDscr", dscr == null ? "—" : dscr.toFixed(2));
  $v("rCashIn", money(Math.round(cashIn)));
  $v("rSeller", money(Math.round(cashToSeller)));
  $v("rLoan", money(Math.round(totalLoan)));
  $v("rAppr", money(Math.round(future)) + "  (+" + money(Math.round(future - g("listed"))) + ")");
  $("#loanAmtDisp").textContent = usesSF ? "Seller note: " + money(Math.round(sfLoan)) : "";

  $("#rCoc").style.color = coc >= target ? "var(--green)" : "var(--red)";
  $("#rMaxDown").style.color = (down <= maxDown && cashflowMo > 0) ? "var(--green)" : "var(--red)";
  $("#rCashflowMo").style.color = cashflowMo >= 0 ? "var(--green)" : "var(--red)";
  const OT_LABEL = { subto: "Subject-To", sellerfinance: "Seller Finance", hybrid: "Hybrid" };
  lastDeal = { offerType: OT_LABEL[offerType], purchase, listed: g("listed"), totalLoan, sfLoan, subtoBal: usesSubto ? subtoBal : 0, down, rate, amort, io, monthlyPmt, cashflowMo, coc, cashIn, cashToSeller, future, rent, opexNoDebt };
}
$$(".ci").forEach((el) => el.addEventListener("input", () => { runDealCalc(); renderSchedule(); }));

// Which loan the amortization table reflects, based on offer type.
function scheduleParams() {
  if (offerType === "cash") return { bal: 0, rate: 0, payment: 0, io: false };
  const purchase = calcGet("purchase"), down = calcGet("down");
  const subtoBal = calcGet("sb1") + calcGet("sb2");
  if (offerType === "subto") {
    return { bal: calcGet("sb1"), rate: calcGet("sr1"), payment: calcGet("sp1"), io: false };
  }
  const sfLoan = offerType === "hybrid" ? Math.max(0, purchase - down - subtoBal) : Math.max(0, purchase - down);
  const rate = calcGet("rate"), amort = calcGet("amort"), io = calcGet("io");
  return { bal: sfLoan, rate, payment: pmt(sfLoan, rate, amort, io), io };
}
function renderSchedule() {
  if (!$("#schedWrap") || $("#schedWrap").style.display === "none") return;
  const p = scheduleParams();
  let bal = p.bal;
  const r = p.rate / 100 / 12;
  const start = new Date();
  let rows = "";
  for (let i = 1; i <= 360 && bal > 0.5; i++) {
    const interest = bal * r;
    const principal = p.io ? 0 : Math.max(0, Math.min(p.payment - interest, bal));
    bal = Math.max(0, bal - principal);
    const d = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
    rows += `<tr><td>${i}</td><td>${d.toLocaleDateString()}</td><td>${money(Math.round(p.payment))}</td><td>${money(Math.round(interest))}</td><td>${money(Math.round(principal))}</td><td>${money(Math.round(bal))}</td></tr>`;
    if (p.io) break; // interest-only: principal never reduces, show one representative row
  }
  $("#schedBody").innerHTML = rows || `<tr><td colspan="6" style="text-align:center;color:var(--muted)">No amortizing loan for this offer type.</td></tr>`;
}
$("#toggleSched").addEventListener("click", () => {
  const w = $("#schedWrap");
  const show = w.style.display === "none";
  w.style.display = show ? "block" : "none";
  $("#toggleSched").textContent = (show ? "Hide" : "Show") + " amortization schedule " + (show ? "▴" : "▾");
  if (show) renderSchedule();
});

$("#attachBtn").addEventListener("click", async () => {
  const id = $("#attachLead").value;
  if (!id) { toast("Pick a lead first", true); return; }
  if (!lastDeal) runDealCalc();
  const d = lastDeal;
  const sfLine = d.sfLoan ? `\nSeller note: ${money(Math.round(d.sfLoan))} @ ${d.rate}% ${d.io ? "interest-only" : d.amort + "yr amort"}` : "";
  const subtoLine = d.subtoBal ? `\nSubject-To balance taken over: ${money(Math.round(d.subtoBal))}` : "";
  const body = `🧮 DEAL ANALYSIS — ${d.offerType}
Purchase: ${money(d.purchase)} | Market: ${money(d.listed)} | Total financed: ${money(Math.round(d.totalLoan))} | Down/Cash to seller: ${money(d.down)}${subtoLine}${sfLine}
Total monthly debt: ${money(Math.round(d.monthlyPmt))}/mo
Cash flow: ${money(Math.round(d.cashflowMo))}/mo (${money(Math.round(d.cashflowMo * 12))}/yr)
Cash to close: ${money(Math.round(d.cashIn))} | Cash-on-cash: ${d.coc.toFixed(1)}%
Cash to seller (after comm.): ${money(Math.round(d.cashToSeller))}`;
  await api(`/api/leads/${id}/activities`, { method: "POST", body: JSON.stringify({ type: "note", body }) });
  toast("Analysis saved to lead ✅");
  loadLeads();
});

function fillAttachLeads() {
  const sel = $("#attachLead");
  if (!sel) return;
  sel.innerHTML = `<option value="">Choose a lead…</option>` +
    leads.map((l) => `<option value="${l.id}">${(l.address || l.seller_name || "Lead #" + l.id)}</option>`).join("");
}

// ---------- Outreach ----------
const esc = (s) => (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MERGE = ["first_name", "seller_name", "address", "city", "my_name", "my_phone", "arv", "repair_estimate", "contract_price"];
let templates = [], outAudience = "leads";

function insertAtCursor(el, text) {
  const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, s) + text + el.value.slice(e);
  el.focus();
  el.selectionStart = el.selectionEnd = s + text.length;
  el.dispatchEvent(new Event("input"));
}
function wireMergeChips(containerId, getTarget) {
  const c = $("#" + containerId);
  if (!c) return;
  c.innerHTML = MERGE.map((f) => `<button type="button" class="chip" data-f="${f}">{{${f}}}</button>`).join("");
  $$("#" + containerId + " .chip").forEach((ch) =>
    ch.addEventListener("click", () => insertAtCursor(getTarget(), "{{" + ch.dataset.f + "}}"))
  );
}

// --- Gmail connection panel ---
async function loadSettings() {
  try { settings = await api("/api/settings"); } catch { settings = {}; }
  renderConnectPanel();
}
function renderConnectPanel() {
  const s = settings, on = s.emailConfigured;
  const panel = $("#connectPanel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="connect-head">
      <div class="status ${on ? "on" : "off"}">${on ? "✅ Gmail connected — " + esc(s.gmailUser) : "⚠️ Email not connected yet — connect your Gmail to send"}</div>
      <button class="btn" id="toggleConnectForm">${on ? "Edit connection" : "Connect Gmail"}</button>
    </div>
    <div id="connectForm" class="connect-form" style="display:${on ? "none" : "block"}">
      <p class="hint">Use a Google <b>App Password</b> (not your normal password). 2-Step Verification must be on first.
        <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">Create an app password →</a></p>
      <div class="row">
        <div class="field"><label>Gmail address</label><input id="setUser" value="${esc(s.gmailUser)}" placeholder="you@gmail.com" /></div>
        <div class="field"><label>App password</label><input id="setPass" type="password" placeholder="${s.hasPassword ? "•••• saved — leave blank to keep" : "16-character app password"}" /></div>
      </div>
      <div class="row">
        <div class="field"><label>From name</label><input id="setFrom" value="${esc(s.fromName)}" placeholder="Sonny | Castle Home Buyers" /></div>
        <div class="field"><label>Your name <span class="hint">{{my_name}}</span></label><input id="setMyName" value="${esc(s.myName)}" /></div>
        <div class="field"><label>Your phone <span class="hint">{{my_phone}}</span></label><input id="setMyPhone" value="${esc(s.myPhone)}" /></div>
      </div>
      <div class="field">
        <label>Email footer <span class="hint">auto-added to every email — legally you need a physical address + an opt-out line</span>
          <button type="button" class="btn xs" id="suggestFooterBtn" style="float:right">Use suggested</button></label>
        <textarea id="setFooter" rows="4" placeholder="Castle Home Buyers&#10;[Your PO Box / mailing address]&#10;Reply 'unsubscribe' to opt out.">${esc(s.emailFooter)}</textarea>
      </div>
      <div class="compose-actions">
        <button class="btn" id="testEmailBtn">Send test to myself</button>
        <button class="btn primary" id="saveSettingsBtn">Save connection</button>
      </div>
    </div>`;
  $("#toggleConnectForm").addEventListener("click", () => {
    const f = $("#connectForm");
    f.style.display = f.style.display === "none" ? "block" : "none";
  });
  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  const tb = $("#testEmailBtn");
  if (tb) tb.addEventListener("click", testEmail);
  const sf = $("#suggestFooterBtn");
  if (sf) sf.addEventListener("click", () => {
    const biz = ($("#setFrom").value.split("|").pop() || "Castle Home Buyers").trim();
    $("#setFooter").value = `${biz}\n[Your mailing address — PO Box or virtual address]\nYou're receiving this regarding your property. Reply "unsubscribe" to opt out.`;
  });
}
async function saveSettings() {
  const body = {
    gmail_user: $("#setUser").value, from_name: $("#setFrom").value,
    my_name: $("#setMyName").value, my_phone: $("#setMyPhone").value,
    email_footer: $("#setFooter").value,
  };
  const pass = $("#setPass").value;
  if (pass) body.gmail_app_password = pass;
  try {
    await api("/api/settings", { method: "POST", body: JSON.stringify(body) });
    await loadSettings();
    toast(settings.emailConfigured ? "Gmail connected ✅" : "Saved — add an app password to finish");
  } catch (e) { toast(e.message, true); }
}
async function testEmail() {
  // Auto-save whatever's in the form first, so the user doesn't have to remember to click Save.
  const passField = $("#setPass");
  if (!settings.emailConfigured || (passField && passField.value)) {
    await saveSettings();
  }
  if (!settings.emailConfigured) {
    toast("Enter your Gmail address + app password first", true);
    return;
  }
  try {
    const r = await api("/api/test-email", { method: "POST", body: JSON.stringify({}) });
    toast("Test sent to " + r.to + " ✅");
  } catch (e) { toast(e.message, true); }
}

// --- Templates ---
async function loadTemplates() { templates = await api("/api/templates"); renderTemplates(); }
function renderTemplates() {
  const el = $("#tmplList");
  if (!templates.length) { el.innerHTML = `<div class="empty">No templates yet. Click “+ New”.</div>`; return; }
  el.innerHTML = templates.map((t) => `
    <div class="tmpl">
      <div class="tmpl-main"><div class="tn">${esc(t.name)}</div><div class="ts">${esc(t.subject)}</div></div>
      <div class="tmpl-actions">
        <span class="badge ${t.audience === "buyers" ? "Assigned" : "New"}">${t.audience === "buyers" ? "Buyers" : "Leads"}</span>
        <button class="btn xs" data-use="${t.id}">Use</button>
        <button class="btn xs" data-edit="${t.id}">Edit</button>
      </div>
    </div>`).join("");
  $$("#tmplList [data-use]").forEach((b) => b.addEventListener("click", () => useTemplate(b.dataset.use)));
  $$("#tmplList [data-edit]").forEach((b) => b.addEventListener("click", () => openTemplate(b.dataset.edit)));
}
function useTemplate(id) {
  const t = templates.find((x) => x.id == id);
  if (!t) return;
  loadRecipients();
  $("#outSubject").value = t.subject;
  $("#outBody").value = t.body;
  toast(`Loaded "${t.name}"`);
}
let currentTmplId = null;
const tmplForm = $("#tmplForm");
$("#newTmplBtn").addEventListener("click", () => {
  currentTmplId = null; tmplForm.reset();
  tmplForm.audience.value = outAudience;
  $("#tmplModalTitle").textContent = "New Template";
  $("#deleteTmplBtn").style.display = "none";
  $("#tmplModal").classList.add("open");
});
function openTemplate(id) {
  const t = templates.find((x) => x.id == id);
  currentTmplId = id; tmplForm.reset();
  tmplForm.name.value = t.name; tmplForm.subject.value = t.subject; tmplForm.body.value = t.body; tmplForm.audience.value = t.audience;
  $("#tmplModalTitle").textContent = "Edit Template";
  $("#deleteTmplBtn").style.display = "";
  $("#tmplModal").classList.add("open");
}
tmplForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = formData(tmplForm);
  if (currentTmplId) await api("/api/templates/" + currentTmplId, { method: "PUT", body: JSON.stringify(d) });
  else await api("/api/templates", { method: "POST", body: JSON.stringify(d) });
  closeModal("tmplModal"); toast("Template saved"); loadTemplates();
});
$("#deleteTmplBtn").addEventListener("click", async () => {
  if (!confirm("Delete this template?")) return;
  await api("/api/templates/" + currentTmplId, { method: "DELETE" });
  closeModal("tmplModal"); toast("Template deleted"); loadTemplates();
});

// --- Recipients & send ---
function fillOutreachStages() {
  $("#outStageFilter").innerHTML = `<option value="">All active stages</option>` + STAGES.map((s) => `<option value="${s}">${s}</option>`).join("");
}
function loadRecipients() {
  const wrap = $("#recipList");
  const sf = $("#outStageFilter").value;
  const list = leads
    .filter((l) => (sf ? l.stage === sf : !["Closed", "Dead"].includes(l.stage)))
    .map((l) => ({ id: l.id, name: l.seller_name || l.address || "Lead #" + l.id, email: l.seller_email }));
  const withEmail = list.filter((r) => r.email);
  const skipped = list.length - withEmail.length;
  $("#recipCount").textContent = `· ${withEmail.length} with email${skipped ? ` (${skipped} skipped, no email)` : ""}`;
  if (!withEmail.length) { wrap.innerHTML = `<div class="empty">No recipients with an email here.</div>`; updateSendCount(); return; }
  wrap.innerHTML = withEmail.map((r) =>
    `<label class="recip"><input type="checkbox" class="recip-cb" value="${r.id}" checked /><span class="rn">${esc(r.name)}</span><span class="re">${esc(r.email)}</span></label>`
  ).join("");
  $$(".recip-cb").forEach((cb) => cb.addEventListener("change", updateSendCount));
  updateSendCount();
}
const selectedRecipIds = () => $$(".recip-cb:checked").map((cb) => +cb.value);
function updateSendCount() { $("#sendCount").textContent = selectedRecipIds().length; }

async function previewOutreach() {
  const id = selectedRecipIds()[0];
  if (!id) return toast("Select a recipient to preview", true);
  const r = await api("/api/outreach/preview", { method: "POST", body: JSON.stringify({ subject: $("#outSubject").value, body: $("#outBody").value, audience: outAudience, id }) });
  alert(`PREVIEW (first recipient)\n\nSubject: ${r.subject}\n\n${r.body}`);
}
async function sendOutreach() {
  const ids = selectedRecipIds();
  const subject = $("#outSubject").value, body = $("#outBody").value;
  if (!settings.emailConfigured) return toast("Connect your Gmail first", true);
  if (!ids.length) return toast("No recipients selected", true);
  if (!subject || !body) return toast("Add a subject and message", true);
  if (!confirm(`Send this email to ${ids.length} recipient(s)? It will be personalized per recipient and logged.`)) return;
  const btn = $("#sendOutreachBtn"); btn.disabled = true;
  $("#outResult").innerHTML = `<div class="sending">Sending to ${ids.length}…</div>`;
  try {
    const r = await api("/api/outreach", { method: "POST", body: JSON.stringify({ subject, body, audience: outAudience, ids }) });
    $("#outResult").innerHTML = `<div class="done">✅ Sent ${r.sent} · ${r.skipped} skipped · ${r.failed} failed</div>` +
      (r.errors && r.errors.length ? `<ul class="errs">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "");
    toast(`Sent ${r.sent} email(s) ✅`);
    if (outAudience === "leads") await loadLeads();
  } catch (err) {
    $("#outResult").innerHTML = `<div class="err-line">${esc(err.message)}</div>`;
    toast(err.message, true);
  }
  btn.disabled = false;
}
$("#outStageFilter").addEventListener("change", loadRecipients);
$("#previewBtn").addEventListener("click", previewOutreach);
$("#sendOutreachBtn").addEventListener("click", sendOutreach);

async function openOutreach() {
  await loadSettings();
  await loadTemplates();
  loadRecipients();
}

// ---------- Acquisitions (Phase 1) ----------
let acqSettings = {}, campaigns = [], currentCampId = null;
const campForm = $("#campForm");

function renderAcqSettings() {
  const s = acqSettings;
  const el = $("#acqSettings");
  if (!el) return;
  const ah = s.autoScanHours ?? 24;
  el.innerHTML = `
    <div class="acq-cfg">
      <div class="cfg-field"><label>Rehab $/sqft</label><input id="cfgRehab" type="number" value="${s.rehabPerSqft ?? 25}" /></div>
      <div class="cfg-field"><label>Buyer %</label><input id="cfgBuyer" type="number" value="${s.buyerPct ?? 70}" /></div>
      <div class="cfg-field"><label>Your fee $</label><input id="cfgFee" type="number" value="${s.minFee ?? 10000}" /></div>
      <div class="cfg-field"><label>Min score shown</label><input id="cfgMinScore" type="number" value="${s.minScore ?? 50}" /></div>
      <div class="cfg-field"><label>Hot-lead score</label><input id="cfgHot" type="number" value="${s.hotScore ?? 60}" /></div>
      <div class="cfg-field"><label>Auto-scan</label>
        <select id="cfgAuto"><option value="24" ${ah == 24 ? "selected" : ""}>Daily</option><option value="12" ${ah == 12 ? "selected" : ""}>Twice daily</option><option value="0" ${ah == 0 ? "selected" : ""}>Off</option></select></div>
      <label class="cfg-check"><input type="checkbox" id="cfgEmail" ${s.emailAlerts ? "checked" : ""} /> Email me hot leads</label>
      <button class="btn primary" id="saveCfgBtn">Apply</button>
    </div>`;
  $("#saveCfgBtn").addEventListener("click", async () => {
    await api("/api/acq/settings", { method: "POST", body: JSON.stringify({
      rehab_per_sqft: $("#cfgRehab").value, buyer_pct: $("#cfgBuyer").value,
      min_fee: $("#cfgFee").value, min_score: $("#cfgMinScore").value,
      hot_score: $("#cfgHot").value, auto_scan_hours: $("#cfgAuto").value, email_alerts: $("#cfgEmail").checked }) });
    acqSettings = await api("/api/acq/settings");
    await api("/api/properties/recompute", { method: "POST" }); // free re-derive, no lookups
    toast("Settings applied");
    loadProperties();
  });
}

async function loadRcSettings() {
  try { acqSettings = await api("/api/acq/settings"); } catch { acqSettings = {}; }
  renderAcqSettings();
  renderAiPanel();
  renderBtPanel();
  renderGmPanel();
  const on = acqSettings.rentcastConnected;
  const p = $("#rcPanel");
  p.innerHTML = `
    <div class="connect-head">
      <div class="status ${on ? "on" : "off"}">${on ? "✅ RentCast connected — scanning enabled" : "⚠️ Connect RentCast to start finding properties"}</div>
      <button class="btn" id="toggleRc">${on ? "Edit key" : "Connect RentCast"}</button>
    </div>
    <div id="rcForm" class="connect-form" style="display:${on ? "none" : "block"}">
      <p class="hint">Get a free API key at <a href="https://app.rentcast.io/app/api" target="_blank" rel="noopener">rentcast.io → API</a> (free tier ~50 lookups/month).</p>
      <div class="field"><label>RentCast API key</label><input id="rcKey" placeholder="${on ? "•••• saved — leave blank to keep" : "paste your API key"}" /></div>
      <div class="compose-actions"><button class="btn primary" id="saveRcBtn">Save key</button></div>
    </div>`;
  $("#toggleRc").addEventListener("click", () => { const f = $("#rcForm"); f.style.display = f.style.display === "none" ? "block" : "none"; });
  $("#saveRcBtn").addEventListener("click", async () => {
    const k = $("#rcKey").value.trim();
    if (!k) return toast("Paste your API key", true);
    await api("/api/acq/settings", { method: "POST", body: JSON.stringify({ rentcast_api_key: k }) });
    toast("RentCast connected ✅"); loadRcSettings();
  });
}

// --- Skip tracing (BatchData) ---
function renderBtPanel() {
  const on = acqSettings.batchdataConnected;
  const p = $("#btPanel");
  if (!p) return;
  p.innerHTML = `
    <div class="connect-head">
      <div class="status ${on ? "on" : "off"}">${on ? "✅ Skip tracing connected — pull owner phone & email on any lead" : "🔎 Connect skip tracing to get owner phone & email"}</div>
      <button class="btn" id="toggleBt">${on ? "Edit key" : "Connect skip tracing"}</button>
    </div>
    <div id="btForm" class="connect-form" style="display:${on ? "none" : "block"}">
      <p class="hint">Get an API token at <a href="https://app.batchdata.com" target="_blank" rel="noopener">app.batchdata.com</a> → Developers/API. Each skip trace costs ~$0.10–0.25 — run it only on your best opportunities. Once connected, every lead gets a <b>🔎 Skip trace</b> button.</p>
      <div class="field"><label>BatchData API token</label><input id="btKey" placeholder="${on ? "•••• saved — leave blank to keep" : "paste your API token"}" /></div>
      <div class="compose-actions"><button class="btn primary" id="saveBtBtn">Save token</button></div>
    </div>`;
  $("#toggleBt").addEventListener("click", () => { const f = $("#btForm"); f.style.display = f.style.display === "none" ? "block" : "none"; });
  $("#saveBtBtn").addEventListener("click", async () => {
    const k = $("#btKey").value.trim();
    if (!k) return toast("Paste your API token", true);
    await api("/api/acq/settings", { method: "POST", body: JSON.stringify({ batchdata_api_key: k }) });
    acqSettings = await api("/api/acq/settings");
    renderBtPanel(); toast("Skip tracing connected ✅");
  });
}

// --- Property imagery (Google Street View + satellite; parcel lines come from county geometry) ---
function renderGmPanel() {
  const on = acqSettings.googleMapsConnected;
  const p = $("#gmPanel");
  if (!p) return;
  p.innerHTML = `
    <div class="connect-head">
      <div class="status ${on ? "on" : "off"}">${on ? "Google imagery connected - Street View + satellite evidence enabled" : "Connect Google Maps for property images, Street View, and satellite evidence"}</div>
      <button class="btn" id="toggleGm">${on ? "Edit key" : "Connect imagery"}</button>
    </div>
    <div id="gmForm" class="connect-form" style="display:${on ? "none" : "block"}">
      <p class="hint">Use a Google Maps Platform key with Street View Static API and Maps Static API enabled. Parcel lines still come from county GIS; Google supplies the imagery layer.</p>
      <div class="field"><label>Google Maps API key</label><input id="gmKey" placeholder="${on ? "saved - leave blank to keep" : "paste your Maps key"}" /></div>
      <div class="compose-actions"><button class="btn primary" id="saveGmBtn">Save key</button></div>
    </div>`;
  $("#toggleGm").addEventListener("click", () => { const f = $("#gmForm"); f.style.display = f.style.display === "none" ? "block" : "none"; });
  $("#saveGmBtn").addEventListener("click", async () => {
    const k = $("#gmKey").value.trim();
    if (!k) return toast("Paste your Google Maps key", true);
    await api("/api/acq/settings", { method: "POST", body: JSON.stringify({ google_maps_api_key: k }) });
    acqSettings = await api("/api/acq/settings");
    renderGmPanel(); toast("Google imagery connected");
  });
}

// --- AI assistant (Claude Opus 4.8) ---
let aiCurrentId = null, aiCurrentText = "";
function renderAiPanel() {
  const on = acqSettings.aiConnected;
  const p = $("#aiPanel");
  if (!p) return;
  p.innerHTML = `
    <div class="connect-head">
      <div class="status ${on ? "on" : "off"}">${on ? "✅ AI assistant connected — Claude Opus 4.8" : "🤖 Connect Claude to auto-write deal briefs"}</div>
      <button class="btn" id="toggleAi">${on ? "Edit key" : "Connect AI"}</button>
    </div>
    <div id="aiForm" class="connect-form" style="display:${on ? "none" : "block"}">
      <p class="hint">Get a key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Each brief costs ~2–5¢ and is cached after the first run.</p>
      <div class="field"><label>Anthropic API key</label><input id="aiKey" placeholder="${on ? "•••• saved — leave blank to keep" : "sk-ant-..."}" /></div>
      <div class="compose-actions"><button class="btn primary" id="saveAiBtn">Save key</button></div>
    </div>`;
  $("#toggleAi").addEventListener("click", () => { const f = $("#aiForm"); f.style.display = f.style.display === "none" ? "block" : "none"; });
  $("#saveAiBtn").addEventListener("click", async () => {
    const k = $("#aiKey").value.trim();
    if (!k) return toast("Paste your API key", true);
    await api("/api/acq/settings", { method: "POST", body: JSON.stringify({ anthropic_api_key: k }) });
    acqSettings = await api("/api/acq/settings");
    renderAiPanel(); toast("AI connected ✅");
  });
}
const inlineMd = (s) => s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<em>$1</em>");
function mdToHtml(md) {
  const lines = esc(md).split("\n");
  let html = "", inList = false;
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) { if (inList) { html += "</ul>"; inList = false; } html += `<h4>${inlineMd(line.replace(/^#{1,6}\s+/, ""))}</h4>`; continue; }
    if (/^[-*]\s+/.test(line)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inlineMd(line.replace(/^[-*]\s+/, ""))}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    if (line.trim()) html += `<p>${inlineMd(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}
async function aiAnalyze(id, force) {
  aiCurrentId = id;
  $("#aiContent").innerHTML = `<div class="ai-loading">Analyzing with Claude Opus 4.8… (a few seconds)</div>`;
  $("#aiModal").classList.add("open");
  try {
    const r = await api(`/api/properties/${id}/ai`, { method: "POST", body: JSON.stringify({ force: !!force }) });
    aiCurrentText = r.analysis;
    $("#aiContent").innerHTML = mdToHtml(r.analysis);
    if (!force) loadProperties();
  } catch (e) { $("#aiContent").innerHTML = `<div class="err-line">${esc(e.message)}</div>`; }
}
$("#aiRegenBtn")?.addEventListener("click", () => { if (aiCurrentId) aiAnalyze(aiCurrentId, true); });
$("#aiCopyBtn")?.addEventListener("click", () => { navigator.clipboard.writeText(aiCurrentText || ""); toast("Copied"); });

async function loadCampaigns() { campaigns = await api("/api/campaigns"); renderCampaigns(); }
function renderCampaigns() {
  const el = $("#campList");
  if (!campaigns.length) { el.innerHTML = `<div class="empty">No campaigns yet. Click “+ New” to set your first search.</div>`; return; }
  el.innerHTML = campaigns.map((c) => {
    const crit = [c.city && `${c.city}${c.state ? ", " + c.state : ""}`, c.property_type, c.price_min && `$${(+c.price_min).toLocaleString()}+`, c.price_max && `<$${(+c.price_max).toLocaleString()}`, c.days_on_market_min && `${c.days_on_market_min}+ DOM`].filter(Boolean).join(" · ");
    return `<div class="camp ${c.active ? "" : "paused"}">
      <div class="camp-main"><div class="cn">${esc(c.name)}${c.active ? "" : ` <span class="hint">(paused)</span>`}</div>
        <div class="cs">${esc(crit || "no filters")}</div>
        ${c.last_run ? `<div class="hint">Last run ${new Date(c.last_run).toLocaleString()} · ${c.last_count} found</div>` : ""}</div>
      <div class="camp-actions">
        <button class="btn xs" data-run="${c.id}">▶ Run</button>
        <button class="btn xs" data-pause="${c.id}">${c.active ? "Pause" : "Resume"}</button>
        <button class="btn xs" data-edit="${c.id}">Edit</button>
      </div></div>`;
  }).join("");
  $$("#campList [data-run]").forEach((b) => b.addEventListener("click", () => runCampaign(b.dataset.run)));
  $$("#campList [data-pause]").forEach((b) => b.addEventListener("click", () => toggleCampaign(b.dataset.pause)));
  $$("#campList [data-edit]").forEach((b) => b.addEventListener("click", () => openCampaign(b.dataset.edit)));
}
async function toggleCampaign(id) {
  const c = campaigns.find((x) => x.id == id);
  await api("/api/campaigns/" + id, { method: "PUT", body: JSON.stringify({ ...c, active: c.active ? 0 : 1 }) });
  loadCampaigns();
}
async function runCampaign(id) {
  if (!acqSettings.rentcastConnected) return toast("Connect RentCast first", true);
  const btn = document.querySelector(`[data-run="${id}"]`);
  if (btn) { btn.textContent = "Scanning…"; btn.disabled = true; }
  toast("Scanning listings + crime… (a few seconds)");
  try {
    const r = await api("/api/campaigns/" + id + "/run", { method: "POST" });
    toast(`Found ${r.found} · ${r.new} new${r.hot ? ` · 🔥 ${r.hot} hot` : ""} — phones + crime loaded`);
    loadCampaigns(); loadProperties(); loadNotifications();
  } catch (e) { toast(e.message, true); if (btn) { btn.textContent = "▶ Run"; btn.disabled = false; } }
}
$("#newCampBtn")?.addEventListener("click", () => {
  currentCampId = null; campForm.reset();
  $("#campModalTitle").textContent = "New Campaign";
  $("#deleteCampBtn").style.display = "none";
  $("#campModal").classList.add("open");
});
function openCampaign(id) {
  const c = campaigns.find((x) => x.id == id); currentCampId = id; campForm.reset();
  for (const k in c) if (campForm.elements[k]) campForm.elements[k].value = c[k] ?? "";
  $("#campModalTitle").textContent = "Edit Campaign";
  $("#deleteCampBtn").style.display = "";
  $("#campModal").classList.add("open");
}
campForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = formData(campForm);
  if (currentCampId) {
    const ex = campaigns.find((x) => x.id == currentCampId);
    await api("/api/campaigns/" + currentCampId, { method: "PUT", body: JSON.stringify({ ...d, active: ex ? ex.active : 1 }) });
  } else {
    await api("/api/campaigns", { method: "POST", body: JSON.stringify(d) });
  }
  closeModal("campModal"); toast("Campaign saved"); loadCampaigns();
});
$("#deleteCampBtn")?.addEventListener("click", async () => {
  if (!confirm("Delete this campaign?")) return;
  await api("/api/campaigns/" + currentCampId, { method: "DELETE" });
  closeModal("campModal"); toast("Campaign deleted"); loadCampaigns();
});

let propFilter = "new", propSort = "score";
async function loadProperties() {
  const all = await api("/api/properties");
  const minScore = acqSettings.minScore ?? 50;
  let props = all.filter((p) => p.lead_score != null && p.lead_score >= minScore);
  if (propFilter === "new") props = props.filter((p) => !p.imported_lead_id);
  else if (propFilter === "imported") props = props.filter((p) => p.imported_lead_id);
  const cmp = {
    score: (a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0),
    recent: (a, b) => (b.created_at || "").localeCompare(a.created_at || ""),
    shootings: (a, b) => (a.crime_shootings_30d ?? 999) - (b.crime_shootings_30d ?? 999) || (b.lead_score ?? 0) - (a.lead_score ?? 0),
    price: (a, b) => (a.price ?? 9e9) - (b.price ?? 9e9),
  };
  props.sort(cmp[propSort] || cmp.score);
  const importedCount = all.filter((p) => p.imported_lead_id).length;
  $("#propCount").textContent = `· ${props.length} shown · ${importedCount} imported · score ≥ ${minScore}`;
  const el = $("#propFeed");
  if (!props.length) {
    const hint = propFilter === "new" ? "No un-imported deals at this score — switch to “All” or “Imported”, or lower Min score shown." : propFilter === "imported" ? "Nothing imported yet — hit “+ Import” on a deal." : `No properties at score ≥ ${minScore}. Lower Min score shown, or run a campaign.`;
    el.innerHTML = `<div class="empty">${all.length ? hint : "Create a campaign and hit ▶ Run to pull listings."}</div>`;
    return;
  }
  el.innerHTML = props.map((p) => `<div class="prop" data-id="${p.id}">${propRowHtml(p)}</div>`).join("");
  wirePropRows();
}
function propRowHtml(p) {
  const scoreCls = (s) => s == null ? "s-none" : s >= 70 ? "s-high" : s >= 40 ? "s-med" : "s-low";
  const facts = [p.property_type, p.bedrooms && p.bedrooms + "bd", p.bathrooms && p.bathrooms + "ba", p.square_footage && (+p.square_footage).toLocaleString() + " sqft", p.days_on_market && p.days_on_market + " DOM"].filter(Boolean).join(" · ");
  const scores = p.motivation_score != null ? `Motiv ${p.motivation_score} · Distress ${p.distress_score}${p.wholesale_score != null ? ` · Wholesale ${p.wholesale_score}` : ""}` : "";
  const gap = p.discount_pct > 0 ? `<b class="neg">${p.discount_pct}% below list</b>` : `<b class="pos">at/above list ✓</b>`;
  const analyzed = p.arv != null ? `<div class="ps analysis">Offer ≤ <b>${money(p.mao)}</b> · Fee <b class="pos">${money(p.spread)}</b> · ${gap} · Cap ${p.cap_rate}% · ARV ${money(p.arv)} · Rent ${money(p.rent_estimate)}/mo</div>` : "";
  const contact = p.listing_agent_phone ? `<div class="ps contact">📞 ${esc(p.listing_agent_name || "Agent")} · ${esc(p.listing_agent_phone)}</div>` : "";
  let crime = "";
  if (p.crime_shootings_30d != null) {
    const n = p.crime_shootings_30d;
    const cc = n === 0 ? "crime-ok" : n <= 2 ? "crime-warn" : "crime-bad";
    crime = `<div class="ps crime ${cc}">🔫 ${n} shooting${n === 1 ? "" : "s"} within 1mi · last 30 days</div>`;
  }
  const imported = p.imported_lead_id ? `<span class="imported-tag pr-tag pr-contact">✓ In Leads</span>` : `<button class="btn xs import-btn" data-id="${p.id}">+ Import to leads</button>`;
  return `
    <div class="prop-top">
      <div class="score-badge ${scoreCls(p.lead_score)}" title="Lead score">${p.lead_score == null ? "—" : p.lead_score}</div>
      <div class="prop-main">
        <div class="pa">${esc(p.formatted_address || p.address || "Property")}</div>
        <div class="ps">${facts}</div>
        ${scores ? `<div class="ps mini">${scores}</div>` : ""}
        ${analyzed}
        ${contact}
        ${crime}
      </div>
      <div class="prop-price">${p.price ? money(p.price) : "—"}</div>
    </div>
    <div class="prop-actions">
      <button class="btn xs analyze-btn" data-id="${p.id}">📊 ${p.arv != null ? "Re-analyze" : "Analyze"} $</button>
      <button class="btn xs ai-btn" data-id="${p.id}">🤖 AI $${p.ai_analysis ? " ✓" : ""}</button>
      <button class="btn xs evidence-btn" data-id="${p.id}">Images</button>
      <button class="btn xs buyers-btn" data-id="${p.id}">Buyers</button>
      ${imported}
    </div>`;
}
function wirePropRows() {
  $$("#propFeed .analyze-btn").forEach((b) => b.addEventListener("click", () => analyzeProperty(b.dataset.id)));
  $$("#propFeed .import-btn").forEach((b) => b.addEventListener("click", () => importProperty(b.dataset.id)));
  $$("#propFeed .ai-btn").forEach((b) => b.addEventListener("click", () => aiAnalyze(b.dataset.id)));
  $$("#propFeed .evidence-btn").forEach((b) => b.addEventListener("click", () => openPropertyEvidence(b.dataset.id)));
  $$("#propFeed .buyers-btn").forEach((b) => b.addEventListener("click", () => openBuyerMatches(b.dataset.id)));
}

function imageryBlock(e) {
  const d = e && e.data ? e.data : e;
  if (!d) return "";
  const imgs = [
    d.street_view && d.street_view.image_url ? ["Street View", d.street_view.image_url] : null,
    d.satellite && d.satellite.image_url ? ["Satellite", d.satellite.image_url] : null,
    d.parcel_overlay && d.parcel_overlay.image_url ? ["Parcel overlay", d.parcel_overlay.image_url] : null,
  ].filter(Boolean);
  return `
    <div class="evidence-meta">
      <b>${esc(d.address || "Property imagery")}</b>
      <span class="muted">${esc(d.street_view?.metadata?.status || d.error || "OK")}</span>
    </div>
    ${imgs.length ? `<div class="evidence-grid">${imgs.map(([label, url]) => `
      <figure><img src="${esc(url)}" alt="${esc(label)}" /><figcaption>${esc(label)}</figcaption></figure>`).join("")}</div>` :
      `<div class="empty">${esc(d.error || "No imagery available yet.")}</div>`}`;
}

async function openPropertyEvidence(id) {
  $("#evidenceTitle").textContent = "Property Images";
  $("#evidenceContent").innerHTML = `<div class="ai-loading">Fetching Street View and satellite evidence...</div>`;
  $("#evidenceModal").classList.add("open");
  try {
    const r = await api(`/api/properties/${id}/imagery`, { method: "POST" });
    $("#evidenceContent").innerHTML = imageryBlock(r.evidence) + (await callHistoryBlock(id));
  } catch (e) {
    $("#evidenceContent").innerHTML = `<div class="err-line">${esc(e.message)}</div>`;
  }
}

// Call history for the evidence modal — every dial is evidence too.
async function callHistoryBlock(propertyId) {
  try {
    const d = await api(`/api/pro-queue/${propertyId}/call-outcomes`);
    if (!d.outcomes || !d.outcomes.length) return "";
    const s = d.summary || {};
    return `
      <div class="evidence-meta" style="margin-top:14px">
        <b>📞 Call history (${d.outcomes.length})</b>
        <span class="muted">${s.outreach_suppressed ? "🚫 outreach suppressed" : esc(s.next_action || "")}</span>
      </div>
      ${d.outcomes.map((o) => `<div class="fu"><span>${esc(o.outcome.replace(/_/g, " "))}${o.seller_price ? ` · asked $${Number(o.seller_price).toLocaleString()}` : ""}${o.offer_amount ? ` · offered $${Number(o.offer_amount).toLocaleString()}` : ""}${o.follow_up_date ? ` · follow up ${o.follow_up_date}` : ""}${o.notes ? ` — ${esc(o.notes)}` : ""}</span><span class="when">${esc((o.created_at || "").slice(0, 10))}</span></div>`).join("")}`;
  } catch { return ""; } // history is additive — never break the imagery view
}

function buyerRows(matches, gaps = []) {
  if (!matches || !matches.length) return `<div class="empty">No buyers in the buyer database yet.</div>`;
  return `${gaps && gaps.length ? `<div class="muted" style="margin-bottom:8px">Buyer discovery gaps: ${esc(gaps.join("; "))}</div>` : ""}<table class="src-table buyer-match-table"><thead><tr><th>Score</th><th>Buyer</th><th>Contact</th><th>Why</th></tr></thead><tbody>${
    matches.map((m) => `<tr>
      <td><b>${m.score}</b><div class="muted">${esc(m.fit)}</div></td>
      <td>${esc(m.name || "Buyer #" + m.buyer_id)}<div class="muted">${esc(m.demand_source || "")}${m.max_price ? ` · max ${money(m.max_price)}` : ""}</div></td>
      <td>${esc([m.phone, m.email].filter(Boolean).join(" · ") || "no contact")}</td>
      <td class="muted">${esc((m.reasons || []).join("; "))}</td>
    </tr>`).join("")
  }</tbody></table>`;
}

async function openBuyerMatches(id) {
  $("#evidenceTitle").textContent = "Motivated Buyer Matches";
  $("#evidenceContent").innerHTML = `<div class="ai-loading">Ranking buyers against this property...</div>`;
  $("#evidenceModal").classList.add("open");
  try {
    const r = await api(`/api/properties/${id}/buyer-matches`);
    $("#evidenceContent").innerHTML = buyerRows(r.matches, r.gaps || []);
  } catch (e) {
    $("#evidenceContent").innerHTML = `<div class="err-line">${esc(e.message)}</div>`;
  }
}

async function importProperty(id) {
  const row = document.querySelector(`.prop[data-id="${id}"]`);
  const btn = row && row.querySelector(".import-btn");
  if (btn) { btn.textContent = "Importing…"; btn.disabled = true; }
  try {
    const r = await api("/api/properties/" + id + "/import", { method: "POST" });
    toast(r.duplicate ? "Linked to existing lead ✅" : "Imported to Leads ✅");
    const p = await api("/api/properties/" + id);
    if (row) { row.innerHTML = propRowHtml(p); row.classList.add("just-analyzed"); wirePropRows(); }
    loadLeads();
  } catch (e) {
    if (btn) { btn.textContent = "+ Import"; btn.disabled = false; }
    toast(e.message, true);
  }
}
async function analyzeProperty(id) {
  const row = document.querySelector(`.prop[data-id="${id}"]`);
  const btn = row && row.querySelector(".analyze-btn");
  if (btn) { btn.textContent = "Analyzing…"; btn.disabled = true; }
  try {
    await api("/api/properties/" + id + "/analyze", { method: "POST" });
    // Update just this row in place so it doesn't jump around in the sorted list.
    const p = await api("/api/properties/" + id);
    if (row) { row.innerHTML = propRowHtml(p); row.classList.add("just-analyzed"); wirePropRows(); }
    toast("Analyzed ✅");
  } catch (e) {
    if (btn) { btn.textContent = "Analyze"; btn.disabled = false; }
    toast(e.message, true);
  }
}
$("#scoreAllBtn")?.addEventListener("click", async () => {
  try { const r = await api("/api/properties/score-all", { method: "POST" }); toast(`Scored ${r.scored} properties`); loadProperties(); }
  catch (e) { toast(e.message, true); }
});
$$("#propFilter .seg-btn").forEach((b) => b.addEventListener("click", () => {
  propFilter = b.dataset.pf;
  $$("#propFilter .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
  loadProperties();
}));
$("#propSort")?.addEventListener("change", (e) => { propSort = e.target.value; loadProperties(); });
$("#scanCrimeBtn")?.addEventListener("click", async () => {
  const btn = $("#scanCrimeBtn");
  btn.textContent = "Scanning crime…"; btn.disabled = true;
  try { const r = await api("/api/properties/scan-crime", { method: "POST" }); toast(`Crime scanned for ${r.scanned} properties`); loadProperties(); }
  catch (e) { toast(e.message, true); }
  btn.textContent = "🔫 Scan crime"; btn.disabled = false;
});

async function openAcquisitions() {
  await loadRcSettings();
  await loadCampaigns();
  await loadProperties();
}

// ---------- Offers sent (with projected vs collected fees) ----------
async function loadOffers() {
  let d;
  try { d = await api("/api/offers"); } catch (e) { $("#offerList").innerHTML = `<div class="err-line" style="padding:16px">${esc(e.message)}</div>`; return; }
  const t = d.totals;
  $("#offerSummary").innerHTML = `
    <div class="osum-card"><div class="osum-n">${t.count}</div><div class="osum-l">Offers sent</div></div>
    <div class="osum-card"><div class="osum-n amber">${money(t.projected)}</div><div class="osum-l">Projected fees <span class="hint">spread, not yet earned</span></div></div>
    <div class="osum-card"><div class="osum-n green">${money(t.collected)}</div><div class="osum-l">Collected <span class="hint">money in hand</span></div></div>`;
  const el = $("#offerList");
  if (!d.offers.length) { el.innerHTML = `<div class="empty">No offers sent yet. Fire some from Outreach → 💵 Send an Offer.</div>`; return; }
  el.innerHTML = d.offers.map((o) => {
    const when = o.offer_sent_at ? new Date(o.offer_sent_at).toLocaleDateString() : "";
    const closed = o.stage === "Closed"; // a fee is only collected once the deal closes
    return `<div class="offer-row" data-id="${o.id}">
      <div class="or-main" data-open="${o.id}">
        <div class="or-addr">${esc(o.address || o.seller_name || "Lead #" + o.id)}</div>
        <div class="or-sub">${esc(o.seller_email || "")} · sent ${when} · <span class="badge ${(o.stage || "").replace(/ /g, "-")}">${esc(o.stage)}</span></div>
      </div>
      <div class="or-nums">
        <div class="or-offer">${o.offer_amount ? money(o.offer_amount) : "—"}<span>offer</span></div>
        <div class="or-fee ${closed ? "green" : "amber"}">${closed ? money(o.fee_collected || 0) : (o.assignment_fee ? money(o.assignment_fee) : "—")}<span>${closed ? "collected ✓" : "projected fee"}</span></div>
        ${closed ? `<button class="btn xs collect-btn" data-id="${o.id}">Edit fee</button>` : `<button class="btn xs primary collect-btn" data-id="${o.id}">Close &amp; collect</button>`}
      </div>
    </div>`;
  }).join("");
  $$("#offerList .or-main").forEach((m) => m.addEventListener("click", () => openLead(m.dataset.open)));
  $$("#offerList .collect-btn").forEach((b) => b.addEventListener("click", () => closeWithFee(b.dataset.id, loadOffers)));
}
// Close a deal and record the fee collected. Used from the Offers tab and the lead-card stage dropdown.
async function closeWithFee(id, after) {
  const input = prompt("Deal closed 🎉 — assignment fee collected at closing ($):", "");
  if (input == null) { loadLeads(); if (after) after(); return; } // cancelled → revert any dropdown
  const amount = parseFloat((input || "").replace(/[^0-9.]/g, "")) || 0;
  try {
    await api(`/api/leads/${id}/collect-fee`, { method: "PATCH", body: JSON.stringify({ amount }) });
    toast(amount ? "Closed — " + money(amount) + " collected 💰" : "Marked closed");
  } catch (e) { toast(e.message, true); }
  loadLeads(); loadDashboard(); if (after) after();
}

// ---------- Offer sender ----------
let offerTemplates = [];
function mergeOffer(text, l) {
  l = l || {};
  const m$ = (n) => (n || n === 0) && !isNaN(n) ? "$" + Number(n).toLocaleString() : "";
  const cleanName = (l.seller_name || "").replace(/\(listing agent\)/i, "").trim();
  const first = (cleanName || "there").split(/\s+/)[0] || "there";
  const map = {
    first_name: first, agent_name: cleanName,
    address: l.address || "the property", city: l.city || "", state: l.state || "",
    offer: m$($("#offerAmount").value), earnest: m$($("#offerEarnest").value),
    close_days: $("#offerClose").value || "", inspection_days: $("#offerInspect").value || "",
    arv: m$(l.arv), repairs: m$(l.repair_estimate),
    my_name: settings.myName || settings.fromName || "", my_phone: settings.myPhone || "",
  };
  return (text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (k in map ? map[k] : m));
}
const currentOfferLead = () => leads.find((l) => l.id == $("#offerLead").value);
function renderOfferPreview() {
  const l = currentOfferLead() || {};
  $("#opSubj").textContent = mergeOffer($("#offerSubject").value, l);
  $("#opBody").innerHTML = esc(mergeOffer($("#offerBody").value, l)).replace(/\n/g, "<br>");
}
function applyOfferTemplate() {
  const t = offerTemplates.find((x) => x.id == $("#offerTemplate").value);
  if (t) { $("#offerSubject").value = t.subject; $("#offerBody").value = t.body; }
  renderOfferPreview();
}

// ----- Combine multiple offer structures into one email -----
const optChecked = (k) => { const cb = document.querySelector(`.os-cb[data-k="${k}"]`); return cb && cb.checked; };
const ofVal = (k) => { const el = document.querySelector(`.of[data-of="${k}"]`); return el ? (parseFloat(el.value) || 0) : 0; };
const m$round = (n) => "$" + Math.round(Number(n) || 0).toLocaleString();
function buildCombinedOffer() {
  const blocks = [];
  // Cash uses {{merge}} placeholders so the Offer amount / EMD / close / inspection fields stay LIVE.
  if (optChecked("cash")) {
    blocks.push({ t: "CASH", b: `• Purchase price: {{offer}}\n• Closing: {{close_days}} days or less, all cash, no financing contingency, purchased as-is\n• Earnest money {{earnest}}, submitted 1 business day after a {{inspection_days}}-business-day inspection` });
  }
  if (optChecked("sf")) {
    const price = ofVal("sfPrice"), down = ofVal("sfDown"), rate = ofVal("sfRate"), yrs = ofVal("sfYears") || 30;
    const monthly = pmt(Math.max(0, price - down), rate, yrs, false);
    $("#sfCalc").textContent = price ? `≈ ${m$round(monthly)}/mo for ${yrs} yrs` : "";
    blocks.push({ t: "SELLER FINANCING", b: `• Purchase price: ${m$round(price)}\n• Down payment to you: ${m$round(down)}\n• Then ${m$round(monthly)}/month for ${yrs} years at ${rate}% interest\n• You collect steady monthly income and a higher overall price` });
  }
  if (optChecked("subto")) {
    blocks.push({ t: "SUBJECT-TO (I take over the payments)", b: `• I take over your existing mortgage payment of ${m$round(ofVal("subPmt"))}/month and keep it current\n• ${m$round(ofVal("subCash"))} cash to you at closing\n• You're relieved of the monthly payment right away` });
  }
  if (!blocks.length) { toast("Check at least one offer structure", true); return; }
  const multi = blocks.length > 1;
  const intro = multi
    ? `I'd like to make an offer on {{address}}. I can structure it a few different ways — pick whichever works best for you:`
    : `I'd like to make an offer on {{address}}:`;
  const body = blocks.map((x, i) => (multi ? `OPTION ${i + 1} — ${x.t}\n` : "") + x.b).join("\n\n");
  const closer = `I'm flexible and easy to work with — if none of these are quite right, tell me what you need and I'll do my best to make it work.\n\nThanks,\n{{my_name}}\n{{my_phone}}`;
  $("#offerBody").value = `Hi {{first_name}},\n\n${intro}\n\n${body}\n\n${closer}`;
  $("#offerSubject").value = (multi ? "A few offer options" : "Cash offer") + " — {{address}}";
  renderOfferPreview();
}
function prefillOfferOptions() {
  const l = currentOfferLead() || {};
  const sfPriceEl = document.querySelector('.of[data-of="sfPrice"]');
  // Seller-finance price defaults higher than cash (the trade for terms): list/ARV, else 1.25× cash offer.
  if (sfPriceEl && !sfPriceEl.value) sfPriceEl.value = Math.round(l.asking_price || l.arv || (suggestedOffer(l) ? suggestedOffer(l) * 1.25 : 0)) || "";
  const subPmtEl = document.querySelector('.of[data-of="subPmt"]');
  if (subPmtEl && !subPmtEl.value && l.mortgage_payment) subPmtEl.value = l.mortgage_payment;
}
// Cash-only → use the clean template; any creative structure on → use the combined builder.
function refreshOfferBody() {
  if (optChecked("sf") || optChecked("subto")) { prefillOfferOptions(); buildCombinedOffer(); }
  else applyOfferTemplate();
}
$("#buildOfferBtn")?.addEventListener("click", buildCombinedOffer);
$$(".os-cb").forEach((cb) => cb.addEventListener("change", () => {
  const f = document.querySelector(`.os-fields[data-for="${cb.dataset.k}"]`);
  if (f) f.style.display = cb.checked ? "block" : "none";
  if (cb.checked) prefillOfferOptions();
  buildCombinedOffer();
}));
$$(".of").forEach((el) => el.addEventListener("input", buildCombinedOffer));
// Suggested cash offer for a lead: prefer the underwritten MAO, fall back to a 70%-rule estimate.
function suggestedOffer(l) {
  if (!l) return "";
  if (l.offer_amount) return Math.round(l.offer_amount);
  if (l.mao != null && l.mao > 0) return Math.round(l.mao);
  if (l.arv) return Math.max(0, Math.round(l.arv * 0.7 - (l.repair_estimate || 0) - 10000));
  return "";
}
const offerReady = (l) => !!(l && l.seller_email && l.seller_email.trim() && !l.offer_sent_at && l.stage !== "Dead");
function offerLeadOptions() {
  const sorted = [...leads].sort((a, b) => {
    const r = (offerReady(b) ? 1 : 0) - (offerReady(a) ? 1 : 0);
    return r || (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1);
  });
  return sorted.map((l) => {
    const mark = l.offer_sent_at ? "✓ " : offerReady(l) ? "• " : "⚠ ";
    const so = suggestedOffer(l);
    return `<option value="${l.id}">${mark}${esc(l.address || l.seller_name || "Lead #" + l.id)}${so ? " — ≤ " + money(so) : ""}</option>`;
  }).join("");
}
function fillOfferLead() {
  const l = currentOfferLead() || {};
  $("#offerTo").value = l.seller_email || "";
  $("#offerAmount").value = suggestedOffer(l) || "";
  const ready = leads.filter(offerReady).length;
  const sentToday = leads.filter((x) => x.offer_sent_at && x.offer_sent_at >= cutoffISO9am()).length;
  $("#offerQueueInfo").innerHTML = `🎯 <b>${ready}</b> ready to offer · <b>${sentToday}</b> sent today. Send fires this lead, then jumps to the next ready one.`;
}
// Most recent 9am ET as ISO (mirrors the server KPI cutoff, good enough for a client-side count).
function cutoffISO9am() {
  const d = new Date(); const et = new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" }));
  et.setHours(9, 0, 0, 0); if (new Date(d.toLocaleString("en-US", { timeZone: "America/New_York" })) < et) et.setDate(et.getDate() - 1);
  return new Date(et.getTime() - (et.getTimezoneOffset() * 60000)).toISOString().slice(0, 19);
}
const nextReadyLeadId = (afterId) => {
  const c = leads.filter((l) => offerReady(l) && l.id != afterId).sort((a, b) => (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1));
  return c.length ? c[0].id : null;
};
async function openOffer(leadId) {
  if (!leads.length) await loadLeads();
  if (!templates.length) await loadTemplates();
  try { settings = await api("/api/settings"); } catch {}
  offerTemplates = templates.filter((t) => t.audience === "offer");
  if (!offerTemplates.length) offerTemplates = templates.filter((t) => t.audience === "leads");
  $("#offerLead").innerHTML = offerLeadOptions();
  const firstReady = [...leads].filter(offerReady).sort((a, b) => (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1))[0];
  $("#offerLead").value = leadId || (firstReady && firstReady.id) || (leads[0] && leads[0].id) || "";
  $("#offerTemplate").innerHTML = offerTemplates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("");
  fillOfferLead();
  refreshOfferBody();
  $("#offerModal").classList.add("open");
}
$("#offerLead")?.addEventListener("change", () => { fillOfferLead(); refreshOfferBody(); });
$("#offerTemplate")?.addEventListener("change", applyOfferTemplate);
["#offerAmount", "#offerEarnest", "#offerClose", "#offerInspect", "#offerSubject", "#offerBody"].forEach((s) => $(s)?.addEventListener("input", renderOfferPreview));
$("#openOfferBtn")?.addEventListener("click", () => openOffer());
$("#offerSendBtn")?.addEventListener("click", async () => {
  const id = $("#offerLead").value;
  const l = currentOfferLead() || {};
  const to = $("#offerTo").value.trim();
  if (!settings.emailConfigured) return toast("Connect your Gmail in Outreach first", true);
  if (!to) return toast("No agent email — add one to the lead", true);
  const subject = mergeOffer($("#offerSubject").value, l), body = mergeOffer($("#offerBody").value, l);
  const offerAmount = parseFloat($("#offerAmount").value) || null;
  const btn = $("#offerSendBtn"); btn.disabled = true; btn.textContent = "Sending…";
  try {
    await api(`/api/leads/${id}/offer`, { method: "POST", body: JSON.stringify({ to, subject, body, offerAmount }) });
    const next = nextReadyLeadId(id);
    await loadLeads(); loadDashboard();
    $("#offerLead").innerHTML = offerLeadOptions();
    if (next) {
      $("#offerLead").value = next;
      fillOfferLead(); refreshOfferBody();
      const nl = currentOfferLead() || {};
      toast("Offer sent ✅ — next: " + (nl.address || nl.seller_name || "lead"));
    } else {
      toast("Offer sent ✅ — queue clear 🎉");
      closeModal("offerModal");
    }
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = "Send offer ✉";
});

// ---------- Prospects (review queue, lives inside the Leads tab) ----------
let prospects = [];
function renderProspects() {
  const q = $("#leadSearch").value.toLowerCase();
  const src = $("#leadSource").value;
  const list = prospects.filter((p) => {
    if (src && (p.source || "Imported") !== src) return false;
    if (!q) return true;
    return [p.address, p.seller_name, p.city].some((v) => (v || "").toLowerCase().includes(q));
  }).sort((a, b) => (b.opportunity_score ?? -1) - (a.opportunity_score ?? -1)); // best opportunities first
  const el = $("#prospectList");
  if (!list.length) { el.innerHTML = `<div class="empty">${prospects.length ? "Nothing matches." : "No prospects. Pull a list from Leads → ⬆ Import list."}</div>`; return; }
  const scoreCls = (s) => s == null ? "s-none" : s >= 70 ? "s-high" : s >= 40 ? "s-med" : "s-low";
  el.innerHTML = list.slice(0, 300).map((p) => {
    const absentee = (p.notes || "").includes("ABSENTEE");
    const contact = p.seller_phone || p.seller_email;
    const uw = p.uw_at ? `<div class="pr-uw">💰 Est value <b>${money(p.arv)}</b> · Offer ≤ <b>${money(p.mao)}</b> · Equity <b class="${p.equity >= 0 ? "pos" : "neg"}">${money(p.equity)}</b></div>` : "";
    return `<div class="prospect" data-id="${p.id}">
      <div class="score-badge ${scoreCls(p.opportunity_score)}" title="Opportunity score">${p.opportunity_score == null ? "—" : p.opportunity_score}</div>
      <div class="pr-main" data-open="${p.id}" title="Open full view">
        <div class="pr-head">${esc(p.seller_name || "Unknown owner")}${absentee ? ` <span class="pr-tag">ABSENTEE</span>` : ""}${contact ? ` <span class="pr-tag pr-contact">📞 has contact</span>` : ""}</div>
        <div class="pr-addr">${esc(p.address || "")}</div>
        ${uw}
        ${p.notes ? `<div class="pr-notes">${esc(p.notes)}</div>` : ""}
      </div>
      <div class="pr-actions">
        ${contact ? "" : `<button class="btn xs pr-trace" data-id="${p.id}">🔎 Skip trace $</button>`}
        <button class="btn xs pr-activate" data-id="${p.id}">✓ Activate</button>
        <button class="btn xs pr-dismiss" data-id="${p.id}">✕ Dismiss</button>
      </div>
    </div>`;
  }).join("") + (list.length > 300 ? `<div class="hint" style="padding:8px">Showing top 300 of ${list.length} — search or filter to narrow.</div>` : "");
  $$("#prospectList .pr-main").forEach((m) => m.addEventListener("click", () => openLead(m.dataset.open)));
  $$("#prospectList .pr-activate").forEach((b) => b.addEventListener("click", () => triageProspect(b.dataset.id, "activate")));
  $$("#prospectList .pr-dismiss").forEach((b) => b.addEventListener("click", () => triageProspect(b.dataset.id, "dismiss")));
  $$("#prospectList .pr-trace").forEach((b) => b.addEventListener("click", () => quickSkiptrace(b.dataset.id)));
}
async function quickSkiptrace(id) {
  const card = document.querySelector(`.prospect[data-id="${id}"]`);
  const btn = card && card.querySelector(".pr-trace");
  if (btn) { btn.disabled = true; btn.textContent = "Tracing…"; }
  try {
    const r = await api("/api/leads/" + id + "/skiptrace", { method: "POST" });
    toast((r.phones.length || r.emails.length) ? `Found ${r.phones.length} phone(s), ${r.emails.length} email(s) ✅` : "No contact found");
    prospects = await api("/api/prospects"); renderProspects();
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = "🔎 Skip trace $"; } toast(e.message, true); }
}
$("#underwriteBtn")?.addEventListener("click", async () => {
  const btn = $("#underwriteBtn"); btn.disabled = true; btn.textContent = "Underwriting…";
  try {
    const r = await api("/api/prospects/underwrite", { method: "POST" });
    toast(`Underwrote ${r.underwritten} of ${r.total} (best deals ranked first)`);
    prospects = await api("/api/prospects"); leads = await api("/api/leads");
    fillSources(); renderCurrentLeadView();
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = "🧮 Underwrite all";
});
async function triageProspect(id, action) {
  try {
    await api(`/api/leads/${id}/triage`, { method: "PATCH", body: JSON.stringify({ action }) });
    prospects = prospects.filter((p) => p.id != id);
    fillSources(); renderProspects();
    if (action === "activate") { toast("Activated — now a working lead ✅"); leads = await api("/api/leads"); }
    else toast("Dismissed");
    loadDashboard();
  } catch (e) { toast(e.message, true); }
}

// ---------- CSV list import ----------
function parseCSV(text) {
  const rows = []; let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}
let importRows = [], importHeaders = [];
function detectMap(headers) {
  const find = (...keys) => { for (let i = 0; i < headers.length; i++) { const h = headers[i].toLowerCase(); if (keys.some((k) => h.includes(k))) return i; } return -1; };
  return {
    seller_name: find("owner name", "owner", "name"),
    seller_phone: find("phone", "mobile", "cell", "tel"),
    seller_email: find("email", "e-mail"),
    address: find("property address", "situs", "site address", "property", "address", "street"),
    city: find("city"),
    state: find("state"),
    zip: find("zip", "postal"),
    notes: find("note", "comment", "violation", "case", "amount", "balance"),
  };
}
function renderImportMap() {
  const el = $("#importMap");
  if (!importHeaders.length) { el.innerHTML = ""; $("#importRunBtn").disabled = true; $("#importInfo").textContent = ""; return; }
  const guess = detectMap(importHeaders);
  const fields = [["seller_name", "Owner name"], ["seller_phone", "Phone"], ["seller_email", "Email"], ["address", "Property address"], ["city", "City"], ["state", "State"], ["zip", "Zip"], ["notes", "Notes"]];
  const opts = (sel) => `<option value="-1">— none —</option>` + importHeaders.map((h, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(h)}</option>`).join("");
  el.innerHTML = `<div class="map-grid">` + fields.map(([k, label]) => `<div class="cfg-field"><label>${label}</label><select data-f="${k}">${opts(guess[k])}</select></div>`).join("") + `</div>`;
  $("#importInfo").textContent = `${importRows.length} rows detected — check the column mapping`;
  $("#importRunBtn").disabled = false;
}
function ingestCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) { importHeaders = []; importRows = []; renderImportMap(); return; }
  importHeaders = rows[0].map((h) => h.trim());
  importRows = rows.slice(1);
  renderImportMap();
}
$("#importBtn")?.addEventListener("click", () => {
  importRows = []; importHeaders = [];
  $("#importFile").value = ""; $("#importPaste").value = ""; renderImportMap();
  $("#importModal").classList.add("open");
});
$("#pullViolBtn")?.addEventListener("click", async () => {
  const days = parseInt($("#violDays").value, 10) || 30;
  const btn = $("#pullViolBtn"); btn.disabled = true; btn.textContent = "Pulling…";
  try {
    const r = await api("/api/leads/pull-violations", { method: "POST", body: JSON.stringify({ days }) });
    toast(`Pulled ${r.found} violations → ${r.imported} new prospects to review`);
    closeModal("importModal"); loadDashboard();
    $('[data-tab="leads"]').click(); setLeadMode("prospects");
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = "Pull code violations";
});
$("#importFile")?.addEventListener("change", (e) => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => ingestCSV(r.result); r.readAsText(f); });
$("#importPaste")?.addEventListener("input", (e) => { if (e.target.value.trim()) ingestCSV(e.target.value); else { importHeaders = []; renderImportMap(); } });
$("#importRunBtn")?.addEventListener("click", async () => {
  const map = {}; $$("#importMap select").forEach((s) => (map[s.dataset.f] = parseInt(s.value, 10)));
  const get = (row, f) => (map[f] >= 0 ? (row[map[f]] || "").trim() : "");
  const leadsArr = importRows.map((row) => ({
    seller_name: get(row, "seller_name"), seller_phone: get(row, "seller_phone"), seller_email: get(row, "seller_email"),
    address: get(row, "address"), city: get(row, "city"), state: get(row, "state"), zip: get(row, "zip"), notes: get(row, "notes"),
  })).filter((l) => l.address || l.seller_name);
  if (!leadsArr.length) return toast("Nothing to import — map a name or address column", true);
  const type = $("#importType").value;
  $("#importRunBtn").disabled = true;
  try {
    const r = await api("/api/leads/import", { method: "POST", body: JSON.stringify({ leads: leadsArr, source: type + " list", motivation: type }) });
    toast(`Imported ${r.imported} prospects · ${r.skipped} skipped (duplicates/blank)`);
    closeModal("importModal"); loadDashboard();
    $('[data-tab="leads"]').click(); setLeadMode("prospects");
  } catch (e) { toast(e.message, true); $("#importRunBtn").disabled = false; }
});

// ---------- Inbox (cached for instant load; sync pulls new mail) ----------
let inboxMessages = [], inboxFilter = "all", openMsg = null;
const timeAgo = (d) => {
  if (!d) return "";
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  if (s < 604800) return Math.round(s / 86400) + "d ago";
  return new Date(d).toLocaleDateString();
};
async function openInbox() {
  const el = $("#inboxList");
  if (!inboxMessages.length) el.innerHTML = `<div class="ai-loading">Loading…</div>`;
  try {
    const d = await api("/api/inbox");
    inboxMessages = d.messages || [];
    $("#inboxSynced").textContent = d.syncedAt ? "Synced " + timeAgo(d.syncedAt) : "Never synced — hit Sync";
    renderInbox();
  } catch (e) { el.innerHTML = `<div class="err-line" style="padding:16px">${esc(e.message)}</div>`; }
}
async function syncInbox() {
  const btn = $("#inboxRefresh"); btn.disabled = true; btn.textContent = "Syncing…";
  try {
    const r = await api("/api/inbox/sync", { method: "POST" });
    toast(r.added ? `${r.added} new email(s)` : "Up to date");
    await openInbox();
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = "↻ Sync new mail";
}
function renderInbox() {
  let list = inboxMessages;
  if (inboxFilter === "leads") list = list.filter((m) => m.leadId);
  else if (inboxFilter === "unread") list = list.filter((m) => !m.read);
  const unread = inboxMessages.filter((m) => !m.read).length;
  $("#inboxCount").textContent = unread ? `· ${unread} unread` : "";
  const el = $("#inboxList");
  if (!list.length) { el.innerHTML = `<div class="empty">${inboxMessages.length ? "Nothing here." : "No mail yet — hit “Sync new mail”."}</div>`; return; }
  el.innerHTML = list.map((m) => {
    const idx = inboxMessages.indexOf(m);
    const who = m.fromName || m.fromEmail || "Unknown";
    const initial = (who.trim()[0] || "?").toUpperCase();
    return `<div class="msg ${m.read ? "" : "unread"}" data-i="${idx}">
      <div class="msg-ava">${esc(initial)}</div>
      <div class="msg-main">
        <div class="msg-line1"><span class="msg-from">${esc(who)}</span>${m.leadId ? ` <span class="msg-lead">🔗 ${esc(m.leadName || "lead")}</span>` : ""}<span class="msg-when">${timeAgo(m.date)}</span></div>
        <div class="msg-subj">${esc(m.subject || "(no subject)")}</div>
        <div class="msg-snip">${esc(m.snippet || "")}</div>
      </div>
    </div>`;
  }).join("");
  $$("#inboxList .msg").forEach((c) => c.addEventListener("click", () => openMessage(inboxMessages[c.dataset.i])));
}
function openMessage(m) {
  if (!m) return;
  openMsg = m;
  if (!m.read) { m.read = true; renderInbox(); } // server marks read when thread/inbox re-read
  $("#msgSubject").textContent = m.subject || "(no subject)";
  $("#msgMeta").innerHTML = `From <b>${esc(m.fromName || "")}</b> &lt;${esc(m.fromEmail)}&gt;${m.leadName ? ` · 🔗 ${esc(m.leadName)}` : ""}<br>${m.date ? new Date(m.date).toLocaleString() : ""}`;
  $("#msgBody").innerHTML = esc(m.body || m.snippet || "(no text content)").replace(/\n/g, "<br>");
  $("#msgReplyBody").value = "";
  const ol = $("#msgOpenLead");
  if (m.leadId) { ol.style.display = ""; ol.onclick = () => { closeModal("msgModal"); $('[data-tab="leads"]').click(); openLead(m.leadId); }; }
  else ol.style.display = "none";
  $("#msgModal").classList.add("open");
}
$("#msgReplySend")?.addEventListener("click", async () => {
  if (!openMsg) return;
  const body = $("#msgReplyBody").value.trim();
  if (!body) return toast("Write a reply", true);
  if (!settings.emailConfigured) return toast("Connect your Gmail in Outreach first", true);
  const subject = (openMsg.subject || "").startsWith("Re:") ? openMsg.subject : "Re: " + (openMsg.subject || "");
  const btn = $("#msgReplySend"); btn.disabled = true; btn.textContent = "Sending…";
  try {
    await api("/api/email/send", { method: "POST", body: JSON.stringify({ to: openMsg.fromEmail, subject, body }) });
    toast("Reply sent ✅");
    closeModal("msgModal");
    openInbox();
  } catch (e) { toast(e.message, true); }
  btn.disabled = false; btn.textContent = "Send reply ✉";
});
$("#inboxRefresh")?.addEventListener("click", syncInbox);
// While viewing the Inbox, re-read the cache every 60s so background auto-synced mail appears.
setInterval(() => { if ($("#inbox")?.classList.contains("active")) openInbox(); }, 60 * 1000);
$$("#inboxFilterSeg .seg-btn").forEach((b) => b.addEventListener("click", () => {
  inboxFilter = b.dataset.if;
  $$("#inboxFilterSeg .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
  renderInbox();
}));

// ---------- Notifications (🔔) ----------
async function loadNotifications() {
  try {
    const d = await api("/api/notifications");
    const badge = $("#bellCount");
    if (badge) { if (d.unread > 0) { badge.textContent = d.unread; badge.style.display = ""; } else badge.style.display = "none"; }
    const el = $("#notifList");
    if (el) el.innerHTML = d.items.length ? d.items.map((n) => `
      <div class="notif ${n.read ? "" : "unread"}">
        <div class="nt">${esc(n.title)}</div>
        <div class="nb">${esc(n.body)}</div>
        <div class="ntime">${new Date(n.created_at).toLocaleString()}</div>
      </div>`).join("") : `<div class="empty" style="padding:14px">No notifications yet. Your daily auto-scan will alert you to new hot leads.</div>`;
  } catch {}
}
$("#bellBtn")?.addEventListener("click", (e) => {
  e.stopPropagation();
  const p = $("#notifPanel");
  const show = p.style.display === "none";
  p.style.display = show ? "block" : "none";
  if (show) loadNotifications();
});
$("#notifReadAll")?.addEventListener("click", async () => {
  await api("/api/notifications/read-all", { method: "POST" });
  loadNotifications();
});
document.addEventListener("click", (e) => {
  const p = $("#notifPanel");
  if (p && p.style.display === "block" && !e.target.closest("#notifPanel") && !e.target.closest("#bellBtn")) p.style.display = "none";
});
setInterval(loadNotifications, 90000);

// ---------- Seller intake (first-party consent queue) ----------
let sellerIntake = null;
function channelLabel(ch) {
  return ch === "sms" ? "text" : ch;
}
function renderSellerIntake(data) {
  const list = $("#sellerIntakeList");
  const summary = $("#sellerIntakeSummary");
  const meta = $("#sellerIntakeMeta");
  if (!list || !summary) return;
  const s = data.summary || {};
  const priorities = s.priority_counts || {};
  const channels = s.allowed_channel_counts || {};
  const channelText = Object.entries(channels).map(([k, v]) => `${esc(channelLabel(k))} ${v}`).join(" · ") || "no allowed channels";
  meta.textContent = data.built_at ? `Built ${new Date(data.built_at).toLocaleString()}` : "";
  summary.innerHTML = `
    <div class="si-stat"><b>${s.consent_records || 0}</b><span>consent records</span></div>
    <div class="si-stat"><b>${s.first_party_contactable || 0}</b><span>contactable by consent</span></div>
    <div class="si-stat"><b>${priorities.hot || 0}</b><span>hot</span></div>
    <div class="si-stat"><b>${priorities.warm || 0}</b><span>warm</span></div>
    <div class="si-stat wide"><b>${esc(channelText)}</b><span>allowed channels</span></div>`;
  const items = data.items || [];
  if (!items.length) {
    list.innerHTML = `<div class="empty">No first-party seller submissions yet.</div>`;
    return;
  }
  list.innerHTML = items.map((item) => {
    const seller = item.seller || {};
    const req = item.request || {};
    const compliance = item.compliance || {};
    const allowed = compliance.allowed_channels || [];
    const badges = allowed.map((ch) => `<span class="pill ok">${esc(channelLabel(ch))}</span>`).join(" ");
    const contact = [seller.phone, seller.email].filter(Boolean).map(esc).join(" · ");
    return `<div class="seller-intake-card priority-${esc(item.priority)}">
      <div class="si-main">
        <div class="si-head">
          <b>${esc(seller.name || "Unknown seller")}</b>
          <span class="pill ${item.priority === "hot" ? "ok" : ""}">${esc(item.priority)}</span>
          <span class="muted">${item.created_at ? new Date(item.created_at).toLocaleString() : ""}</span>
        </div>
        <div class="si-address">${esc(seller.address || "Address not provided")}</div>
        <div class="muted">${esc(contact || "No visible contact field")}${badges ? " · " + badges : ""}</div>
        <div class="si-action">${esc(item.next_action || "review consent record")}</div>
      </div>
      <div class="si-side">
        <div><b>${item.priority_score || 0}</b><span>score</span></div>
        <div class="muted">${esc(req.source || "first_party_landing")}</div>
        <div class="${compliance.outreach_allowed ? "ok" : "err"}">${compliance.outreach_allowed ? "outreach allowed" : "review only"}</div>
      </div>
    </div>`;
  }).join("");
}
function renderSellerPromotions(data) {
  const list = $("#sellerPromotionList");
  const summary = $("#sellerPromotionSummary");
  if (!list || !summary) return;
  const s = data.summary || {};
  const counts = s.status_counts || {};
  summary.innerHTML = `
    <div class="si-stat"><b>${s.matched_properties || 0}</b><span>matched properties</span></div>
    <div class="si-stat"><b>${s.ready_for_proof || 0}</b><span>proof-ready</span></div>
    <div class="si-stat"><b>${counts.create_workflow_record || 0}</b><span>needs record</span></div>
    <div class="si-stat"><b>${s.needs_address || 0}</b><span>needs address</span></div>`;
  const items = data.items || [];
  if (!items.length) {
    list.innerHTML = `<div class="empty">No promotion candidates yet.</div>`;
    return;
  }
  list.innerHTML = items.map((item) => {
    const seller = item.seller || {};
    const prop = item.property || {};
    const workflow = item.workflow || {};
    const channels = (seller.allowed_channels || []).map((ch) => `<span class="pill ok">${esc(channelLabel(ch))}</span>`).join(" ");
    const proofLink = workflow.proof_url
      ? `<a class="btn xs" href="${esc(workflow.proof_url)}" target="_blank" rel="noreferrer">Proof</a>`
      : `<span class="muted">No proof link yet</span>`;
    return `<div class="seller-intake-card priority-${item.status === "matched_property" ? "hot" : "warm"}">
      <div class="si-main">
        <div class="si-head">
          <b>${esc(seller.name || "Unknown seller")}</b>
          <span class="pill">${esc(item.status || "review")}</span>
          ${channels}
        </div>
        <div class="si-address">${esc(prop.address || seller.address || "Address not provided")}</div>
        <div class="si-action">${esc(workflow.next_action || "review promotion candidate")}</div>
      </div>
      <div class="si-side">
        <div><b>${prop.matched ? "Yes" : "No"}</b><span>property match</span></div>
        ${proofLink}
      </div>
    </div>`;
  }).join("");
}
async function loadSellerIntake() {
  const list = $("#sellerIntakeList");
  const promotionList = $("#sellerPromotionList");
  if (list) list.innerHTML = `<div class="ai-loading">Loading...</div>`;
  if (promotionList) promotionList.innerHTML = `<div class="ai-loading">Loading...</div>`;
  try {
    const [intake, promotions] = await Promise.all([
      api("/api/seller-intake/leads?limit=100"),
      api("/api/seller-intake/promotions?limit=100"),
    ]);
    sellerIntake = intake;
    renderSellerIntake(sellerIntake);
    renderSellerPromotions(promotions);
  } catch (e) {
    if (list) list.innerHTML = `<div class="err-line" style="padding:16px">${esc(e.message)}</div>`;
    if (promotionList) promotionList.innerHTML = `<div class="err-line" style="padding:16px">${esc(e.message)}</div>`;
  }
}
$("#sellerIntakeRefresh")?.addEventListener("click", loadSellerIntake);

// ---------- Init ----------
(async function init() {
  fillStages();
  try { settings = await api("/api/settings"); } catch {}
  await loadLeads();
  await loadDashboard();
  applyOfferType();
  runDealCalc();
  fillOutreachStages();
  wireMergeChips("mergeChips", () => $("#outBody"));
  wireMergeChips("tmplMergeChips", () => tmplForm.body);
  loadNotifications();
})();

// ---------- Fill Properties (one-button, no-spend pipeline) ----------
let _fillPoll = null;

async function loadFill() {
  await reloadFillQueue();
  loadFillCoverage();
  try {
    const runs = await api("/api/pipeline/runs");
    const active = runs.find((r) => r.status === "running");
    if (active) pollFill(active.id);
    else if (runs[0]) renderFillRun(await api("/api/pipeline/runs/" + runs[0].id));
  } catch { /* no runs yet */ }
}

// Why the funnel narrows: enrichment coverage from the last build.
async function loadFillCoverage() {
  const el = $("#fillCoverage");
  if (!el) return;
  try {
    const c = await api("/api/pipeline/coverage");
    const total = c.total || 1;
    const pct = (missing) => Math.round(100 * (1 - (missing || 0) / total));
    const m = c.top_missing || {};
    const dial = c.dial_activity ? ` · dials ${c.dial_activity.total_outcomes} (follow-ups due ${c.dial_activity.followups_due})` : "";
    const wave2 = c.promotion_yield?.research_phone_only ? ` · <b>wave-2: ${c.promotion_yield.research_phone_only}</b> research rows are phone-only` : "";
    el.innerHTML = `coverage of ${total.toLocaleString()} properties — ` +
      `owner <b>${pct(m.owner)}%</b> · ARV <b>${pct(m.arv)}%</b> · buyer demand <b>${pct(m.buyer_demand)}%</b> · seller phone <b>${pct(m.seller_phone)}%</b>` +
      `${dial}${wave2} <span class="muted">(built ${esc((c.built_at || "").slice(0, 16).replace("T", " "))})</span>`;
  } catch { el.textContent = ""; }
}

function renderFillRun(run) {
  const box = $("#fillStages");
  if (!box) return;
  if (!run || !run.stages) { box.innerHTML = ""; return; }
  box.innerHTML = run.stages.map((s) => {
    const ico = s.status === "ok" ? "✅" : s.status === "error" ? "❌" : s.status === "running" ? "⏳" : s.status === "skipped" ? "⏭️" : "•";
    const ms = s.ms ? (s.ms > 1000 ? (s.ms / 1000).toFixed(1) + "s" : s.ms + "ms") : "";
    const err = s.error ? ` <span style="color:var(--red,#ef4444)">— ${esc(String(s.error).slice(0, 140))}</span>` : "";
    const opt = s.optional ? ' <span class="muted">(optional)</span>' : "";
    return `<div class="fill-stage ${esc(s.status)}"><span class="st-ico">${ico}</span><span>${esc(s.label)}</span>${opt}${err}<span class="st-ms">${ms}</span></div>`;
  }).join("");
  const st = $("#fillStatus");
  if (st) st.textContent = run.status === "running" ? "running: " + (run.current_stage || "") : run.status === "done" ? "done ✓" : run.status === "error" ? "finished with errors" : run.status || "";
}

async function pollFill(runId) {
  if (_fillPoll) clearInterval(_fillPoll);
  const btn = $("#fillRun");
  const stop = () => { if (_fillPoll) clearInterval(_fillPoll); _fillPoll = null; if (btn) { btn.disabled = false; btn.textContent = "▶ Run pipeline"; } };
  const tick = async () => {
    try {
      const run = await api("/api/pipeline/runs/" + runId);
      renderFillRun(run);
      if (run.status !== "running") {
        stop();
        await reloadFillQueue();
        toast(run.status === "done" ? "Pipeline complete" : "Pipeline finished with errors", run.status !== "done");
      }
    } catch (e) { stop(); toast(e.message, true); }
  };
  _fillPoll = setInterval(tick, 1500);
  tick();
}

async function runFill() {
  const btn = $("#fillRun");
  const body = {
    preset: $("#fillPreset").value,
    hotScore: Number($("#fillHot").value) || undefined,
    minScore: Number($("#fillMin").value) || undefined,
    maxSources: Number($("#fillMaxSrc").value) || undefined,
  };
  btn.disabled = true; btn.textContent = "Starting…";
  try {
    const r = await api("/api/pipeline/run", { method: "POST", body: JSON.stringify(body) });
    btn.textContent = "Running…";
    pollFill(r.run_id);
  } catch (e) {
    btn.disabled = false; btn.textContent = "▶ Run pipeline";
    toast(e.message, true);
  }
}

function fillQueryParams() {
  const tiers = $$(".fillTier").filter((c) => c.checked).map((c) => c.value);
  const p = new URLSearchParams();
  if (tiers.length) p.set("tier", tiers.join(","));
  if ($("#fillOwnerKnown").checked) p.set("owner_known", "1");
  if ($("#fillDistress").checked) p.set("distress", "1");
  if ($("#fillReady")?.checked) p.set("ready", "1");
  const sp = $("#fillSpread")?.value; if (sp) p.set("spread", sp);
  const sg = $("#fillSignal")?.value; if (sg) p.set("signal", sg);
  const mg = Number($("#fillMinGrade").value); if (mg > 0) p.set("min_grade", String(mg));
  p.set("limit", String(Number($("#fillLimit").value) || 100));
  return p.toString();
}

async function reloadFillQueue() {
  const body = $("#fillBody");
  if (!body) return;
  try {
    const d = await api("/api/pro-queue?" + fillQueryParams());
    if ($("#fillCounts")) {
      const c = d.counts ? Object.entries(d.counts).map(([t, n]) => `${t}: ${n}`).join("  ·  ") : "";
      $("#fillCounts").textContent = c + (d.total != null ? `   (showing ${d.returned}/${d.total})` : "");
    }
    const items = d.items || [];
    if (!items.length) { body.innerHTML = '<tr><td colspan="9" class="muted">No rows match these filters.</td></tr>'; return; }
    const OUTCOMES = ["contacted", "no_answer", "voicemail", "wrong_number", "seller_price", "offer_made", "follow_up", "do_not_call", "dead"];
    const outcomeSel = (it) => it.next_action === "do_not_contact"
      ? '<span title="seller refused contact">🚫 suppressed</span>'
      : `<select class="fillOutcome" data-pid="${it.property_id}">
          <option value="">record…</option>
          ${OUTCOMES.map((o) => `<option value="${o}">${o.replace(/_/g, " ")}</option>`).join("")}
        </select>`;
    body.innerHTML = items.map((it) => {
      const why = (it.why_not_call_now || []).map((w) => (w && (w.label || w.key)) || w).join(", ");
      return `<tr>
        <td class="tier-${esc(it.tier)}">${esc(it.tier)}</td>
        <td>${it.priority_score ?? ""}</td>
        <td>${esc(it.formatted_address || it.address || "")}</td>
        <td>${esc(it.city || "")}</td>
        <td>${esc(it.owner_name || "—")}</td>
        <td>${money(it.arv)}</td>
        <td>${money(it.mao)}</td>
        <td class="fill-why">${it.call_now_ready ? '<span style="color:var(--green,#22c55e)">ready ✓</span>' : esc(why)}</td>
        <td>${outcomeSel(it)}</td>
      </tr>`;
    }).join("");
  } catch (e) {
    body.innerHTML = `<tr><td colspan="9" class="muted">${esc(e.message || "pro-queue not built yet — run the pipeline")}</td></tr>`;
  }
}

// Record what happened on the dial, straight from the queue row. The couple of
// outcomes that need extra facts collect them via prompt() — deliberate, zero
// new modal surface. do_not_call double-confirms because it is permanent.
async function recordFillOutcome(pid, outcome, selEl) {
  const body = { outcome };
  if (outcome === "seller_price") {
    const p = Number(prompt("Seller's asking price ($):"));
    if (!Number.isFinite(p) || p <= 0) { selEl.value = ""; return; }
    body.seller_price = p;
  }
  if (outcome === "offer_made") {
    const a = Number(prompt("Offer amount ($):"));
    if (!Number.isFinite(a) || a <= 0) { selEl.value = ""; return; }
    body.offer_amount = a;
  }
  if (outcome === "offer_made" || outcome === "follow_up") {
    const d = prompt("Follow-up date (YYYY-MM-DD):", new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10));
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) { selEl.value = ""; return; }
    body.follow_up_date = d;
  }
  if (outcome === "do_not_call" && !confirm("Permanently suppress ALL outreach to this property? This cannot be undone from the UI.")) { selEl.value = ""; return; }
  try {
    const r = await api(`/api/pro-queue/${pid}/call-outcome`, { method: "POST", body: JSON.stringify(body) });
    toast(`Recorded: ${outcome.replace(/_/g, " ")} → ${r.recorded.next_action}`);
    reloadFillQueue();
  } catch (e) { toast(e.message, true); selEl.value = ""; }
}

// 🧠 Parse resolver: the memory-first parser choice, on a button.
async function resolveParse() {
  const out = $("#parseResult");
  let record;
  try { record = JSON.parse($("#parseInput").value || "{}"); }
  catch { out.innerHTML = '<span style="color:var(--red)">not valid JSON</span>'; return; }
  try {
    const r = await api("/api/parse/resolve", { method: "POST", body: JSON.stringify(record) });
    if (!r.kind) { out.innerHTML = `no registered kind matches this shape <span class="muted">(${esc(r.signature)})</span>`; return; }
    const src = r.source === "memory" ? `🧠 memory hit (${r.hits ?? "?"}x)` : "🔍 detected + remembered";
    out.innerHTML = `kind: <b>${esc(r.kind)}</b> · ${src} · <span class="muted">${esc(r.signature)}${r.matched ? " · matched: " + esc(r.matched.join(", ")) : ""}</span>`;
  } catch (e) { out.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
}

(function wireFill() {
  const pr = $("#parseResolveBtn"); if (pr) pr.addEventListener("click", resolveParse);
  const run = $("#fillRun"); if (run) run.addEventListener("click", runFill);
  const reload = $("#fillReload"); if (reload) reload.addEventListener("click", reloadFillQueue);
  $$(".fillTier").forEach((c) => c.addEventListener("change", reloadFillQueue));
  // Outcome selects are re-rendered per reload → one delegated listener on the tbody.
  const fb = $("#fillBody");
  if (fb) fb.addEventListener("change", (e) => {
    const sel = e.target.closest(".fillOutcome");
    if (sel && sel.value) recordFillOutcome(Number(sel.dataset.pid), sel.value, sel);
  });
  ["fillOwnerKnown", "fillDistress", "fillReady", "fillSpread", "fillSignal", "fillMinGrade", "fillLimit"].forEach((id) => { const el = $("#" + id); if (el) el.addEventListener("change", reloadFillQueue); });
})();

// ---------- Command shell: cube node → striker → overlay nav ----------
(function commandShell() {
  const cube = $("#cubeLauncher"), striker = $("#striker"), overlay = $("#menuOverlay"), scrim = $("#menuScrim");
  if (!cube || !overlay) return;
  let busy = false;

  function openMenu() {
    if (busy || overlay.classList.contains("open")) return;
    busy = true;
    striker.classList.add("go");                       // bolt flies in from the left…
    setTimeout(() => cube.classList.add("flung"), 340); // …impact: cube knocked off the right side
    setTimeout(() => {
      overlay.classList.add("open");                   // nav slides in over the current view
      striker.classList.remove("go");
      busy = false;
    }, 520);
  }
  function closeMenu() {
    overlay.classList.remove("open");
    setTimeout(() => cube.classList.remove("flung"), 240); // cube tumbles back to its corner
  }

  cube.addEventListener("click", () => (overlay.classList.contains("open") ? closeMenu() : openMenu()));
  if (scrim) scrim.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

  // Accordion groups
  $$("#menuSide .menu-head").forEach((h) => h.addEventListener("click", () => h.parentElement.classList.toggle("open")));

  // Selecting a view: the existing router (bound on .tab) switches the section;
  // we close the overlay, open that tab's group next time, and update the label.
  $$("#menuSide .tab").forEach((b) => b.addEventListener("click", () => {
    const label = $("#brandView"); if (label) label.textContent = b.textContent.trim();
    closeMenu();
  }));
})();
