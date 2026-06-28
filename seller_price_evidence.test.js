import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestSellerPriceEvidence,
  extractSellerPriceEvidence,
  sellerPriceEvidenceFromRecord,
  structuredSellerPriceEvidence,
} from "./seller_price_evidence.js";

test("extracts high-confidence seller acceptable price from notes", () => {
  const out = extractSellerPriceEvidence("Seller said he would take 85k if we can close fast.", { source: "activity" });
  assert.equal(out.length, 1);
  assert.equal(out[0].price, 85000);
  assert.equal(out[0].confidence, "high");
});

test("extracts medium-confidence asking price but ignores repair/arv amounts", () => {
  const out = extractSellerPriceEvidence("ARV $180,000, repairs $35,000. Asking price is $92,500.");
  assert.deepEqual(out.map((x) => x.price), [92500]);
  assert.equal(out[0].confidence, "medium");
});

test("structured fields beat weak text", () => {
  const items = sellerPriceEvidenceFromRecord(
    { id: 9, asking_price: 110000, contract_price: 88000 },
    [{ source: "note", text: "Maybe 100k." }],
  );
  assert.equal(bestSellerPriceEvidence(items).price, 88000);
  assert.deepEqual(structuredSellerPriceEvidence({ offer_amount: 77000 }).map((x) => x.price), []);
});
