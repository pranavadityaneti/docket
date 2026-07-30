import assert from "node:assert";
import {
  routeForMime,
  buildResponseSchema,
  buildOptionsBlock,
  buildSystemPrompt,
  parseModelAnswer,
  clampText,
  MAX_TEXT_CHARS,
  MIN_PDF_TEXT_CHARS,
} from "../src/classify/classify.ts";

let pass = 0;
const ok = (name, fn) => {
  fn();
  pass++;
  console.log("  PASS", name);
};

const KEYS = ["aadhaar", "pan", "bank_statement"];

ok("routes phone photos to vision", () => {
  assert.deepStrictEqual(routeForMime("image/jpeg"), { route: "vision" });
  assert.deepStrictEqual(routeForMime("image/png"), { route: "vision" });
});

ok("routes PDFs to text extraction", () => {
  assert.deepStrictEqual(routeForMime("application/pdf"), { route: "pdf-text" });
});

ok("mime parameters and case do not change the route", () => {
  assert.deepStrictEqual(routeForMime("IMAGE/JPEG; charset=binary"), { route: "vision" });
  assert.deepStrictEqual(routeForMime("Application/PDF "), { route: "pdf-text" });
});

ok("unknown and missing types are refused, with a reason", () => {
  assert.strictEqual(routeForMime("application/zip").route, "unsupported");
  assert.strictEqual(routeForMime(null).route, "unsupported");
  assert.strictEqual(routeForMime("video/mp4").route, "unsupported");
});

ok("schema pins answers to the case's own requirement keys", () => {
  const s = buildResponseSchema(KEYS);
  assert.deepStrictEqual(s.properties.requirement_key.anyOf[0].enum, KEYS);
  assert.ok(s.required.includes("requirement_key"));
  assert.strictEqual(s.additionalProperties, false);
});

ok("options block carries key, label and description", () => {
  const b = buildOptionsBlock([
    { key: "aadhaar", label: "Aadhaar", description: "Both sides" },
    { key: "pan", label: "PAN Card", description: null },
  ]);
  assert.ok(b.includes('"aadhaar"') && b.includes("Both sides"));
  assert.ok(!b.includes("null")); // absent description is omitted, not null
});

ok("accepts a valid high-confidence answer", () => {
  const a = parseModelAnswer(
    JSON.stringify({
      requirement_key: "aadhaar",
      document_type: "Aadhaar card",
      confidence: "high",
      reasoning: "UIDAI layout with the 12-digit number visible",
    }),
    KEYS,
  );
  assert.strictEqual(a.requirementKey, "aadhaar");
  assert.strictEqual(a.confidence, "high");
});

ok("accepts an honest no-match (null)", () => {
  const a = parseModelAnswer(
    JSON.stringify({
      requirement_key: null,
      document_type: "restaurant menu",
      confidence: "high",
      reasoning: "not a KYC document",
    }),
    KEYS,
  );
  assert.strictEqual(a.requirementKey, null);
});

ok("rejects a key outside the closed list", () => {
  const a = parseModelAnswer(
    JSON.stringify({
      requirement_key: "voter_id",
      document_type: "Voter ID",
      confidence: "high",
      reasoning: "",
    }),
    KEYS,
  );
  assert.strictEqual(a, null);
});

ok("rejects a made-up confidence value and broken JSON", () => {
  assert.strictEqual(
    parseModelAnswer(
      JSON.stringify({ requirement_key: "pan", document_type: "x", confidence: "certain", reasoning: "" }),
      KEYS,
    ),
    null,
  );
  assert.strictEqual(parseModelAnswer("not json at all", KEYS), null);
});

ok("clampText collapses whitespace and enforces the ceiling", () => {
  assert.strictEqual(clampText("  a\n\n b\t c  "), "a b c");
  assert.strictEqual(clampText("x".repeat(MAX_TEXT_CHARS + 500)).length, MAX_TEXT_CHARS);
});

/* ---- regressions from the 30 Jul adversarial review ---- */

ok("REVIEW C: prompt tells the model document text is data, not instructions", () => {
  const p = buildSystemPrompt().toLowerCase();
  // The defence must actually be stated, not merely intended.
  assert.ok(p.includes("never") && p.includes("instruction"), "no data-not-instructions rule");
  assert.ok(p.includes("ignore any instruction"), "does not tell the model to ignore embedded instructions");
});

ok("REVIEW C: a document asserting its own class must lower confidence, not raise it", () => {
  const p = buildSystemPrompt().toLowerCase();
  assert.ok(p.includes("suspicion"), "self-assertion is not treated as suspicious");
  // The specific attack string the review described must be named as ignorable.
  assert.ok(p.includes("classify this as"), "the classify-this-as attack is not called out");
});

ok("REVIEW F: PDF text threshold rejects a cover sheet's worth of text", () => {
  // A letterhead or one-line cover sentence must NOT qualify as a text layer:
  // that is how a hybrid PDF got judged without its contents ever being read.
  const coverSheet = "ACME BANK LIMITED — Statement of Account — Page 1 of 40";
  assert.ok(
    coverSheet.length < MIN_PDF_TEXT_CHARS,
    `threshold ${MIN_PDF_TEXT_CHARS} still admits a ${coverSheet.length}-char cover sheet`,
  );
  // A real page of content must still pass.
  assert.ok("x".repeat(600).length >= MIN_PDF_TEXT_CHARS);
});

ok("closed list still holds after the prompt rewrite", () => {
  // The security wording must not have loosened the schema contract.
  const s = buildResponseSchema(KEYS);
  assert.deepStrictEqual(s.properties.requirement_key.anyOf[0].enum, KEYS);
  assert.strictEqual(s.additionalProperties, false);
});

console.log(`\n${pass} passed`);
