import assert from "node:assert";
import {
  clampText,
  MAX_TEXT_CHARS,
  MIN_PDF_TEXT_CHARS,
  routeForMime,
} from "../src/classify/classify-helpers.ts";
import { calibrate, scoresToProbs } from "../src/classify/local-ml/calibration.ts";
import { getLabels } from "../src/classify/local-ml/ontology.ts";
import { mapSlot } from "../src/classify/local-ml/slot-mapper.ts";
import { MODEL_VERSION } from "../src/classify/local-ml/constants.ts";

let pass = 0;
const ok = (name, fn) => {
  fn();
  pass++;
  console.log("  PASS", name);
};

ok("routes images to image path", () => {
  assert.deepStrictEqual(routeForMime("image/jpeg"), { route: "image" });
  assert.deepStrictEqual(routeForMime("image/png"), { route: "image" });
});

ok("routes PDFs to pdf path", () => {
  assert.deepStrictEqual(routeForMime("application/pdf"), { route: "pdf" });
});

ok("mime parameters do not change the route", () => {
  assert.deepStrictEqual(routeForMime("IMAGE/JPEG; charset=binary"), {
    route: "image",
  });
});

ok("unknown types are refused", () => {
  assert.strictEqual(routeForMime("application/zip").route, "unsupported");
  assert.strictEqual(routeForMime(null).route, "unsupported");
});

ok("clampText respects ceiling", () => {
  assert.strictEqual(clampText("  a   b  "), "a b");
  assert.strictEqual(clampText("x".repeat(MAX_TEXT_CHARS + 50)).length, MAX_TEXT_CHARS);
});

ok("MIN_PDF_TEXT_CHARS rejects cover sheets", () => {
  assert.ok(MIN_PDF_TEXT_CHARS >= 250);
});

ok("ontology has KYC labels + other", () => {
  const ids = getLabels().map((l) => l.id);
  assert.ok(ids.includes("pan_card"));
  assert.ok(ids.includes("gst_certificate"));
  assert.ok(ids.includes("other"));
});

ok("slot mapper binds pan_card to applicant_pan", () => {
  const slotId = mapSlot({
    ontologyLabel: "pan_card",
    slots: [
      { id: "bank_statements", title: "Bank statements", description: "6 months" },
      { id: "applicant_pan", title: "Applicant PAN", description: "The PAN card" },
    ],
  });
  assert.strictEqual(slotId, "applicant_pan");
});

ok("slot mapper returns null for other / weak matches", () => {
  assert.strictEqual(mapSlot({ ontologyLabel: "other", slots: [{ id: "x", title: "X" }] }), null);
  assert.strictEqual(
    mapSlot({
      ontologyLabel: "pan_card",
      slots: [{ id: "marksheet_10", title: "Class 10 marksheet", description: "Board" }],
    }),
    null,
  );
});

ok("scoresToProbs + calibrate abstain on other / low margin", () => {
  const probs = scoresToProbs([
    { id: "other", score: 0.8 },
    { id: "pan_card", score: 0.2 },
  ]);
  const cal = calibrate(probs);
  assert.strictEqual(cal.band, "unknown");

  const low = calibrate({ pan_card: 0.15, photograph: 0.14, other: 0.01 });
  assert.strictEqual(low.band, "unknown");
});

ok("calibrate awards high only at ≥89%", () => {
  const high = calibrate({
    pan_card: 0.91,
    other: 0.05,
    photograph: 0.04,
  });
  assert.strictEqual(high.label, "pan_card");
  assert.strictEqual(high.band, "high");

  const notHigh = calibrate({
    pan_card: 0.8,
    other: 0.1,
    photograph: 0.1,
  });
  assert.notStrictEqual(notHigh.band, "high");
});

ok("model version is local-ml", () => {
  assert.ok(MODEL_VERSION.startsWith("local-ml"));
  assert.ok(!MODEL_VERSION.toLowerCase().includes("openai"));
  assert.ok(!MODEL_VERSION.toLowerCase().includes("gpt"));
});

console.log(`\n${pass} tests passed`);
