// ============================================================================
// api.js — thin client for /api/ws/* (and the shared /api/tasks capture)
// ============================================================================
async function req(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${method} ${path} → ${r.status}`);
  return data;
}
export const get = (p) => req("GET", p);
export const post = (p, b) => req("POST", p, b);
export const patch = (p, b) => req("PATCH", p, b);
export const del = (p) => req("DELETE", p);

// derived, never stored (spec Phase 2)
export const mao = (arv, repairs, fee) =>
  Math.round((+arv || 0) * 0.70 - (+repairs || 0) - (+fee || 0));

export const money = (v) => (v == null || Number.isNaN(+v)) ? "—" : "$" + Math.round(+v).toLocaleString("en-US");
export const daysAgo = (iso) => iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : null;
