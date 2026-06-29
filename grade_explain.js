// grade_explain.js -- turn a property_score.js grade result into something a human reads.
// The grade is a 0-100 number + a factors[] breakdown; this makes it explainable: a letter
// badge, the top positive/negative drivers, and a one-line "why". Pure, no I/O. Composes with
// the proof stack / UI / reports so a wholesaler sees WHY a lead is ranked where it is.

const FACTOR_LABEL = {
  distress_base: "source distress",
  owner_signal: "owner signals",
  value_equity: "value & spread room",
  data_completeness: "data completeness",
  portfolio: "bulk-seller portfolio",
};

// Letter badge for quick scanning. A/B = work now, C = research, D = park it.
export function gradeBadge(grade) {
  if (grade === null || grade === undefined || grade === "") return "?";
  const g = Number(grade);
  if (!Number.isFinite(g)) return "?";
  if (g >= 70) return "A";
  if (g >= 55) return "B";
  if (g >= 35) return "C";
  return "D";
}

// Top contributing factors by absolute points (positive = helps, negative = hurts).
export function topFactors(factors = [], n = 3) {
  return [...factors]
    .filter((f) => Number(f.points) !== 0)
    .sort((a, b) => Math.abs(Number(b.points)) - Math.abs(Number(a.points)))
    .slice(0, n)
    .map((f) => ({ factor: f.factor, label: FACTOR_LABEL[f.factor] || f.factor, points: Number(f.points) }));
}

// One-line human explanation, e.g. "Grade 87 (A): driven by owner signals (+40), source
// distress (+31); held back by — . Reasons: absentee owner; wide ARV->MAO spread room."
export function explainGrade(gradeResult = {}) {
  const grade = Number(gradeResult.grade);
  const badge = gradeBadge(grade);
  const top = topFactors(gradeResult.factors || [], 4);
  const pos = top.filter((f) => f.points > 0).map((f) => `${f.label} (+${f.points})`);
  const neg = top.filter((f) => f.points < 0).map((f) => `${f.label} (${f.points})`);
  const reasons = (gradeResult.reasons || []).slice(0, 4).join("; ");
  const drivers = pos.length ? `driven by ${pos.join(", ")}` : "no positive drivers";
  const drags = neg.length ? `; held back by ${neg.join(", ")}` : "";
  return `Grade ${Number.isFinite(grade) ? grade : "?"} (${badge}): ${drivers}${drags}.${reasons ? ` Reasons: ${reasons}.` : ""}`;
}
