// ============================================================================
// focus-coach.mjs — Agent 5: the ADHD daily-command brain
// ============================================================================
// Turns raw CRM state (KPIs + open tasks + due follow-ups) into ONE ordered
// plan and a single NEXT ACTION with a timebox. Deterministic ranker at the
// core; Claude (@anthropic-ai/sdk, already a dependency) optionally rewrites
// the next-action copy into calm one-thing-at-a-time coaching — degrades
// silently to the deterministic text when no credentials are available.

// --- deterministic ranker ---------------------------------------------------
// Priority ladder (money-first, momentum-second):
//   1. due/overdue follow-ups (hot pipeline decays fastest)
//   2. offer-ready approval tasks queued by the underwriting agent
//   3. tasks due today or overdue
//   4. the biggest KPI gap, expressed as ONE small step ("call the next 1")
//   5. everything else, soonest-due first
const today = () => new Date().toISOString().slice(0, 10);

// "Call 20 sellers" is a wall; "Call the next seller (12/20)" is a step.
export function shrinkStep(title, done = null, target = null) {
  const m = title.match(/^(\w+)\s+(\d+)\s+(.*)$/);
  if (!m) return title;
  const [, verb, n, rest] = m;
  if (+n <= 1) return title;
  const singular = rest.replace(/^([a-z]+)s\b/i, "$1");
  const progress = done != null && target != null ? ` (${done}/${target})` : ` (1 of ${n})`;
  return `${verb} the next 1 ${singular}${progress}`;
}

export function rankPlan({ kpis, tasks = [], followups = { leads: [], calls: [] } }) {
  const plan = [];
  const t = today();

  for (const f of followups.leads) {
    plan.push({
      kind: "followup", timeboxMin: 10,
      title: `Follow up: ${f.seller_name || "seller"} — ${f.address || "lead #" + f.id}`,
      why: `due ${f.next_followup} · stage ${f.stage}`,
    });
  }
  for (const c of followups.calls) {
    plan.push({
      kind: "followup", timeboxMin: 10,
      title: `Call back: ${c.address || c.formatted_address || "property #" + c.property_id}`,
      why: `follow-up due ${c.follow_up_date} · last outcome: ${c.outcome}`,
    });
  }

  const isOfferTask = (x) => /^send offer/i.test(x.title);
  const dueToday = (x) => x.due_date && x.due_date <= t;
  for (const task of tasks.filter(isOfferTask)) {
    plan.push({ kind: "offer", timeboxMin: 15, taskId: task.id, title: task.title, why: "offer ready — money moment" });
  }
  for (const task of tasks.filter((x) => !isOfferTask(x) && dueToday(x))) {
    plan.push({ kind: "task", timeboxMin: 15, taskId: task.id, title: shrinkStep(task.title), why: `due ${task.due_date}` });
  }

  // Biggest relative KPI gap → one synthetic small step.
  if (kpis) {
    const gaps = [
      { key: "calls", label: "seller", verb: "Call", ...kpis.calls },
      { key: "offers", label: "offer", verb: "Send", ...kpis.offers },
      { key: "newLeads", label: "new lead", verb: "Review", ...kpis.newLeads },
      { key: "stageAdvances", label: "lead one stage", verb: "Advance", ...kpis.stageAdvances },
    ].filter((g) => Number.isFinite(g.target) && g.done < g.target)
      .sort((a, b) => a.done / a.target - b.done / b.target);
    if (gaps[0]) {
      const g = gaps[0];
      plan.push({
        kind: "kpi", timeboxMin: 10,
        title: `${g.verb} the next 1 ${g.label} (${g.done}/${g.target})`,
        why: `today's biggest KPI gap: ${g.key}`,
      });
    }
  }

  for (const task of tasks.filter((x) => !isOfferTask(x) && !dueToday(x))) {
    plan.push({ kind: "task", timeboxMin: 15, taskId: task.id, title: shrinkStep(task.title), why: task.due_date ? `due ${task.due_date}` : "open" });
  }

  return plan;
}

export function getNextAction(state) {
  const plan = rankPlan(state);
  if (!plan.length) {
    return { title: "All clear — go pull fresh leads or take the win", why: "nothing due, no KPI gaps", timeboxMin: 25, kind: "clear" };
  }
  return plan[0];
}

// --- optional Claude polish --------------------------------------------------
// One tiny non-streaming call that rewrites the next action as calm coaching.
// Any failure (no creds, offline, rate limit) → return the deterministic
// action untouched. Disabled after the first failure so the terminal never
// stalls on a dead network. The SDK also resolves `ant auth login` profiles,
// so we attempt when either ANTHROPIC_API_KEY or CRM_COACH_AI=1 is set.
let coachDisabled = false;

export async function polishNextAction(action, kpis) {
  if (coachDisabled) return action;
  if (!process.env.ANTHROPIC_API_KEY && process.env.CRM_COACH_AI !== "1") return action;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();
    const response = await client.messages.create(
      {
        model: "claude-opus-4-8",
        max_tokens: 120,
        system:
          "You are a calm ADHD-aware focus coach for a real-estate wholesaler. " +
          "Rewrite the next action as ONE short imperative line (max 12 words), " +
          "concrete and startable in 10 seconds. No preamble, no emoji, no quotes.",
        messages: [{
          role: "user",
          content: `Next action: ${action.title}\nWhy: ${action.why}\nKPIs: ${JSON.stringify(kpis)}`,
        }],
      },
      { timeout: 8_000, maxRetries: 0 },
    );
    const text = response.content.find((b) => b.type === "text")?.text.trim();
    return text ? { ...action, title: text, coached: true } : action;
  } catch {
    coachDisabled = true; // stay snappy offline; deterministic text is fine
    return action;
  }
}
