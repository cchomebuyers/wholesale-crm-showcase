// owner_portfolio.test.js -- portfolio detection must group name variants, exclude
// institutional/placeholder owners, and rank real private bulk owners.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeOwner, isPlaceholderOwner, detectPortfolios, portfolioSignal } from "./owner_portfolio.js";

test("normalizeOwner collapses entity-suffix + punctuation variants to one key", () => {
  assert.equal(normalizeOwner("ONLY PROPERTIES, LLC"), normalizeOwner("ONLY PROPERTIES L.L.C."));
  assert.equal(normalizeOwner("Lorber Enterprises LLC"), "LORBER ENTERPRISES LLC");
  assert.equal(normalizeOwner("Smith & Sons Inc."), "SMITH AND SONS INC");
});

test("isPlaceholderOwner flags non-owner strings", () => {
  assert.equal(isPlaceholderOwner("TAXPAYER OF"), true);
  assert.equal(isPlaceholderOwner("NAME NOT ON FILE"), true);
  assert.equal(isPlaceholderOwner("LORBER ENTERPRISES LLC"), false);
});

test("detectPortfolios groups variants and excludes institutional + placeholder", () => {
  const rows = [
    { id: 1, owner_name: "ONLY PROPERTIES, LLC", state: "IL" },
    { id: 2, owner_name: "ONLY PROPERTIES LLC", state: "IL" },
    { id: 3, owner_name: "CHICAGO BOARD OF ED", state: "IL" },   // institutional -> excluded
    { id: 4, owner_name: "CHICAGO BOARD OF ED", state: "IL" },
    { id: 5, owner_name: "TAXPAYER OF", state: "IL" },           // placeholder -> excluded
    { id: 6, owner_name: "TAXPAYER OF", state: "IL" },
    { id: 7, owner_name: "JANE DOE", state: "IL" },              // single -> below minSize
  ];
  const p = detectPortfolios(rows, { minSize: 2 });
  assert.equal(p.length, 1);
  assert.equal(p[0].normalized, "ONLY PROPERTIES LLC");
  assert.equal(p[0].count, 2);
  assert.deepEqual(p[0].property_ids.sort(), [1, 2]);
  assert.equal(p[0].entity, true);
});

test("detectPortfolios excludes truncated county institutional names", () => {
  const rows = [
    { id: 1, owner_name: "CHICAGO HSING AUTHORTI" }, { id: 2, owner_name: "CHICAGO HSING AUTHORTI" },
    { id: 3, owner_name: "CATHOLIC BISHOP CHGO" }, { id: 4, owner_name: "CATHOLIC BISHOP CHGO" },
    { id: 5, owner_name: "NEW YORK UNIVERSITY" }, { id: 6, owner_name: "NEW YORK UNIVERSITY" },
    { id: 7, owner_name: "LORBER ENTERPRISES LLC" }, { id: 8, owner_name: "LORBER ENTERPRISES LLC" },
  ];
  const p = detectPortfolios(rows, { minSize: 2 });
  assert.equal(p.length, 1);
  assert.equal(p[0].normalized, "LORBER ENTERPRISES LLC");
});

test("detectPortfolios ranks larger portfolios first", () => {
  const rows = [
    { id: 1, owner_name: "BIG HOLD LLC" }, { id: 2, owner_name: "BIG HOLD LLC" }, { id: 3, owner_name: "BIG HOLD LLC" },
    { id: 4, owner_name: "SMALL HOLD LLC" }, { id: 5, owner_name: "SMALL HOLD LLC" },
  ];
  const p = detectPortfolios(rows, { minSize: 2 });
  assert.equal(p[0].normalized, "BIG HOLD LLC");
  assert.equal(p[0].count, 3);
});

test("portfolioSignal scales with holdings, zero for singles", () => {
  assert.equal(portfolioSignal(1).points, 0);
  assert.equal(portfolioSignal(2).points, 5);
  assert.equal(portfolioSignal(3).points, 8);
  assert.equal(portfolioSignal(6).points, 12);
});
