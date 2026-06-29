// tools/pro_queue_report.mjs — the pro wholesaler's daily work list.
// Turns the enrichment chain (owner-join, absentee/entity signals, cash-buyer demand) into a
// ranked, actionable report: "skip-trace these today, research these, ignore the rest."
// Read-only. Writes data/pro_queue_report.md and prints the top targets.
//
// Run: node tools/pro_queue_report.mjs [--top=25]

import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { skiptraceDecision, summarizeSkiptrace } from "../skiptrace_gate.js";

const dir = dirname(fileURLToPath(import.meta.url));
const repo = join(dir, "..");
const DB = process.env.CRM_DB || join(repo, "crm.db");
const OUT = join(repo, "data", "pro_queue_report.md");
const top = Number((process.argv.find((a) => a.startsWith("--top=")) || "").split("=")[1] || 25);

const db = new DatabaseSync(DB);
const tierCounts = Object.fromEntries(db.prepare("SELECT tier, COUNT(*) c FROM pro_queue GROUP BY tier").all().map((r) => [r.tier, r.c]));
const owners = db.prepare("SELECT COUNT(*) c FROM properties WHERE owner_name IS NOT NULL AND owner_name<>''").get().c;
const buyers = (() => { try { return db.prepare("SELECT COUNT(*) c FROM buyer_discovery_candidates").get().c; } catch { return 0; } })();

const sig = (j, k) => { try { return JSON.parse(j)[k]; } catch { return null; } };

const rows = db.prepare(`
  SELECT q.priority_score, q.tier, q.next_action, q.signals_json, q.spend_allowed,
         p.address, p.formatted_address, p.city, p.state, p.county, p.source, p.owner_name, p.owner_mailing,
         p.arv, p.mao
  FROM pro_queue q JOIN properties p ON p.id = q.property_id
  WHERE q.tier IN ('call_now','pay_to_unlock') AND p.owner_name IS NOT NULL AND p.owner_name<>''
  ORDER BY CASE q.tier WHEN 'call_now' THEN 0 ELSE 1 END, q.priority_score DESC
  LIMIT ${Number.isFinite(top) ? top : 25}
`).all();

const flag = (b) => (b === true ? "yes" : b === false ? "no" : "?");
const lines = [];
lines.push("# Pro Wholesaler — Daily Work List");
lines.push("");
lines.push(`Generated: ${new Date().toISOString()}`);
lines.push("");
lines.push("## Queue");
lines.push("```");
lines.push(`call_now      ${tierCounts.call_now || 0}`);
lines.push(`pay_to_unlock ${tierCounts.pay_to_unlock || 0}   <- skip-trace these (owner known, distress, demand)`);
lines.push(`research      ${tierCounts.research || 0}`);
lines.push(`hold          ${tierCounts.hold || 0}`);
lines.push(`owners joined ${owners}   cash buyers ${buyers}`);
lines.push("```");
lines.push("");
lines.push("call_now is 0 because reaching the seller needs a phone (paid skip-trace / DNC-checked);");
lines.push("every row below is owner-known + distressed + has investor demand = a real skip-trace target.");
lines.push("");

// Cost-to-unlock: run the skip-trace spend gate across every spend-eligible record.
const spendRows = db.prepare(`
  SELECT q.tier, q.signals_json, p.owner_name, p.owner_mailing, p.address, p.formatted_address
  FROM pro_queue q JOIN properties p ON p.id = q.property_id
  WHERE q.tier IN ('call_now','pay_to_unlock')
`).all();
const spendDecisions = spendRows.map((r) => skiptraceDecision(
  { owner_name: r.owner_name, owner_mailing: r.owner_mailing, address: r.address, formatted_address: r.formatted_address },
  { tier: r.tier, signals: (() => { try { return JSON.parse(r.signals_json); } catch { return {}; } })() },
));
const spend = summarizeSkiptrace(spendDecisions);
lines.push("## Cost to unlock (paid step)");
lines.push("```");
lines.push(`skip-trace approved: ${spend.allowed} of ${spend.total} spend-eligible records`);
lines.push(`est. max spend:      $${spend.est_max_spend}   (@ $0.15/lookup) to get seller phones`);
lines.push(`denied (free first): ${spend.denied}   (owner-join / ARV / demand still needed)`);
lines.push("```");
lines.push("Approved = owner known + distress + ARV/demand. Found phones stay outreach_allowed:false");
lines.push("until DNC/consent — skip-trace unlocks the number, compliance unlocks the call.");
lines.push("");
lines.push(`## Top ${rows.length} skip-trace targets`);
lines.push("");
const money = (v) => (Number(v) > 0 ? "$" + Math.round(Number(v)).toLocaleString() : "—");
lines.push("| # | priority | address | owner | absentee | entity | ARV | max offer (MAO) | buyer demand | buyer acceptance | next action |");
lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
rows.forEach((r, i) => {
  const addr = (r.address || r.formatted_address || "?") + (r.city && r.city !== "1" ? `, ${r.city}` : "") + (r.state ? ` ${r.state}` : "");
  const bm = sig(r.signals_json, "buyer_demand");
  const acceptanceScore = sig(r.signals_json, "buyer_acceptance_score");
  const acceptanceRating = sig(r.signals_json, "buyer_acceptance_rating");
  const acceptance = acceptanceScore ? `${acceptanceScore}x ${acceptanceRating || ""}`.trim() : "unknown";
  lines.push(`| ${i + 1} | ${r.priority_score} | ${addr} | ${r.owner_name} | ${flag(sig(r.signals_json, "absentee_owner"))} | ${flag(sig(r.signals_json, "entity_owner"))} | ${money(r.arv)} | ${money(r.mao)} | ${bm ? "yes" : "no"} | ${acceptance} | ${r.next_action} |`);
});
lines.push("");

const report = lines.join("\n") + "\n";
writeFileSync(OUT, report);
console.log(report);
console.log(`wrote ${OUT}`);
