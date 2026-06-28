// property_signals.test.js -- real wholesale signals from owner-join data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addrCore, isEntityOwner, isInstitutionalOwner, deriveSignals } from "./property_signals.js";

test("addrCore reduces to house# + first street word, ignoring suffix/dir/unit/truncation", () => {
  assert.equal(addrCore("1429 N SPRINGFIELD AVE"), "1429 SPRINGFIELD");
  assert.equal(addrCore("1429 N SPRINGFIELD"), "1429 SPRINGFIELD");      // Cook mailing truncates suffix
  assert.equal(addrCore("3501 OLYMPUS BLVD#500"), "3501 OLYMPUS");
  assert.equal(addrCore("715 E 50TH ST APT 3"), "715 50TH");
});

test("entity + institutional owner detection", () => {
  assert.equal(isEntityOwner("MAPLE COURT LLC"), true);
  assert.equal(isEntityOwner("PEDRO TENA DIAZ TRUST"), true);
  assert.equal(isEntityOwner("MIGUEL FLORES"), false);
  assert.equal(isInstitutionalOwner("CHICAGO TRANSIT AUTHOR"), true);
  assert.equal(isInstitutionalOwner("CITY OF CHICAGO"), true);
  assert.equal(isInstitutionalOwner("MIGUEL FLORES"), false);
});

test("owner-occupied: mailing matches property", () => {
  const s = deriveSignals({ address: "1429 N SPRINGFIELD AVE", owner_name: "MIGUEL FLORES", owner_mailing: "1429 N SPRINGFIELD" });
  assert.equal(s.owner_known, true);
  assert.equal(s.absentee_owner, false);
  assert.equal(s.owner_occupied, true);
});

test("absentee owner: mailing differs from property -> strong motivation signal", () => {
  const s = deriveSignals({ address: "11306 S DRAKE AVE", owner_name: "TERRENCE SHANKLIN", owner_mailing: "3501 OLYMPUS BLVD#500" });
  assert.equal(s.absentee_owner, true);
  assert.ok(s.signal_score >= 40); // owner_known(15) + absentee(25)
  assert.ok(s.reasons.some((r) => /absentee/i.test(r)));
});

test("entity absentee owner stacks entity + absentee", () => {
  const s = deriveSignals({ address: "1120 E 47TH ST", owner_name: "MAPLE COURT LLC", owner_mailing: "32 N DEAN ST 2ND FLR" });
  assert.equal(s.entity_owner, true);
  assert.equal(s.absentee_owner, true);
  assert.ok(s.signal_score >= 50);
});

test("institutional owner is penalized (not a seller lead)", () => {
  const s = deriveSignals({ address: "2842 W BELDEN AVE", owner_name: "CHICAGO TRANSIT AUTHOR" });
  assert.equal(s.institutional_owner, true);
  assert.ok(s.signal_score < 0);
});

test("no owner -> absentee undecidable (null), low signal", () => {
  const s = deriveSignals({ address: "100 Main St" });
  assert.equal(s.owner_known, false);
  assert.equal(s.absentee_owner, null);
  assert.equal(s.signal_score, 0);
});
