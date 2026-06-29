// property_score.js -- grade a property by its OWN fields, not by its source.
//
// Frontier #8 (LOOP_PROMPT.md): today `lead_score` is flat per source -- every
// cook-il-violations row is 64, every CA parcel row is 26 (see data/pro_queue_summary.json
// + `SELECT lead_score,COUNT(*) ... GROUP BY lead_score`). That grades the DATASET, not the
// house. This module produces a differentiated 0-100 `property_grade` from the record's real
// fields so two rows from the same source rank differently:
//   - distress depth (distress/motivation/lead score the harvest already carries)
//   - owner signals  (absentee / entity / institutional -- reused from property_signals.js)
//   - value + equity headroom (ARV known, and the ARV->MAO spread room a wholesaler keeps)
//   - data completeness (year_built / square_footage present = easier to underwrite)
//
// Pure: no I/O. Additive -- writes a NEW field, never mutates lead_score, so it cannot disturb
// CLAUDE-A's queue or CODEX's import. Wiring into pro_wholesaler_queue ranking is a separate,
// coordinated step (announced in councilRoom before any shared-file edit).

import { deriveSignals } from "./property_signals.js";

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// The distress the harvest already established for this record (0-100). Prefer the most
// property-specific signal available; fall back through the chain; default 0.
function distressBase(p) {
  return num(p.distress_score) ?? num(p.motivation_score) ?? num(p.wholesale_score) ?? num(p.lead_score) ?? 0;
}

// ARV -> MAO headroom: how much gross spread room exists between resale value and the max
// offer. More room = more negotiating space = a better deal, independent of source.
function equityHeadroom(p) {
  const arv = num(p.arv);
  const mao = num(p.mao);
  if (!arv || arv <= 0 || mao === null) return null;
  return Math.max(0, Math.min(1, (arv - mao) / arv));
}

// gradeProperty(property) -> { grade, tier_hint, factors[], reasons[] }
// grade is 0-100 and MEANT to differ between two same-source rows.
export function gradeProperty(property = {}) {
  const factors = [];
  const reasons = [];

  // 1. Distress base, weighted 0.45 so enrichment/owner signals have headroom to move the
  //    number (a flat per-source base alone would saturate everyone identically).
  const base = distressBase(property);
  const basePts = Math.round(base * 0.45);
  factors.push({ factor: "distress_base", value: base, points: basePts });
  if (base >= 60) reasons.push(`source distress signal ${base}`);

  // 2. Owner signals -- the real differentiator now that owner-join is done.
  const sig = deriveSignals(property);
  factors.push({ factor: "owner_signal", value: sig.signal_score, points: sig.signal_score });
  for (const r of sig.reasons) reasons.push(r);

  // 3. Value known + equity headroom.
  let valuePts = 0;
  if (num(property.arv)) { valuePts += 8; reasons.push("ARV known (underwritable)"); }
  const head = equityHeadroom(property);
  if (head !== null) {
    if (head >= 0.3) { valuePts += 8; reasons.push("wide ARV->MAO spread room"); }
    else if (head >= 0.15) { valuePts += 4; reasons.push("moderate ARV->MAO spread room"); }
  }
  factors.push({ factor: "value_equity", value: head, points: valuePts });

  // 4. Data completeness -- small bumps; easier to underwrite/contact.
  let dataPts = 0;
  if (num(property.year_built)) dataPts += 2;
  if (num(property.square_footage)) dataPts += 2;
  if (property.city && String(property.city).trim() && String(property.city).trim() !== "1") dataPts += 1;
  factors.push({ factor: "data_completeness", value: dataPts, points: dataPts });

  const raw = basePts + sig.signal_score + valuePts + dataPts;
  const grade = Math.max(0, Math.min(100, Math.round(raw)));

  // Informational tier hint (the canonical tiering still lives in pro_wholesaler_queue.js;
  // institutional owners are forced low here because they are not sellers).
  let tier_hint;
  if (sig.institutional_owner) tier_hint = "hold";
  else if (grade >= 70) tier_hint = "hot";
  else if (grade >= 55) tier_hint = "warm";
  else if (grade >= 35) tier_hint = "research";
  else tier_hint = "hold";

  return { grade, tier_hint, factors, reasons };
}

// Summarize a batch -- used by the apply tool to PROVE the score is no longer flat.
export function summarizeGrades(grades = []) {
  const vals = grades.map((g) => (typeof g === "number" ? g : g.grade)).filter((v) => Number.isFinite(v));
  if (!vals.length) return { count: 0, distinct: 0, min: null, max: null, mean: null, spread: 0 };
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const mean = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
  return { count: vals.length, distinct: new Set(vals).size, min, max, mean, spread: max - min };
}
