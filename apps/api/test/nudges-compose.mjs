import assert from "node:assert";
import {
  collectNudgeItems,
  composeEmail,
  composeWhatsappParams,
} from "../src/nudges/compose.ts";

let pass = 0;
const ok = (name, fn) => {
  fn();
  pass++;
  console.log("  PASS", name);
};

const ctx = { contactName: "Asha", tenantName: "Acme Loans", caseReference: "DKT-7F3K2M" };

ok("collects required-missing and rejected, skips optional-missing and satisfied", () => {
  const items = collectNudgeItems({
    items: [
      { key: "pan", label: "PAN card", required: true, status: "missing", documents: [] },
      { key: "sel", label: "Selfie", required: false, status: "missing", documents: [] },
      { key: "acc", label: "Bank statement", required: true, status: "accepted", documents: [] },
      {
        key: "aad",
        label: "Aadhaar",
        required: true,
        status: "rejected",
        documents: [{ status: "rejected", rejectionReason: "blurry" }],
      },
    ],
  });
  assert.deepStrictEqual(items, [
    { key: "pan", label: "PAN card", state: "missing" },
    { key: "aad", label: "Aadhaar", state: "rejected", reason: "blurry" },
  ]);
});

ok("rejected with no reason yields undefined reason", () => {
  const items = collectNudgeItems({
    items: [
      {
        key: "aad",
        label: "Aadhaar",
        required: true,
        status: "rejected",
        documents: [{ status: "rejected", rejectionReason: null }],
      },
    ],
  });
  assert.strictEqual(items[0].reason, undefined);
});

ok("optional rejected item is still nudged (re-send)", () => {
  const items = collectNudgeItems({
    items: [
      {
        key: "extra",
        label: "Extra proof",
        required: false,
        status: "rejected",
        documents: [{ status: "rejected", rejectionReason: "wrong doc" }],
      },
    ],
  });
  assert.deepStrictEqual(items, [
    { key: "extra", label: "Extra proof", state: "rejected", reason: "wrong doc" },
  ]);
});

ok("complete checklist yields empty items", () => {
  const items = collectNudgeItems({
    items: [
      { key: "pan", label: "PAN card", required: true, status: "accepted", documents: [] },
    ],
  });
  assert.strictEqual(items.length, 0);
});

ok("expired required document is chased as a fresh ask", () => {
  const items = collectNudgeItems({
    items: [
      {
        key: "bank",
        label: "Bank statement",
        required: true,
        status: "expired",
        documents: [{ status: "expired", rejectionReason: null }],
      },
    ],
  });
  assert.deepStrictEqual(items, [{ key: "bank", label: "Bank statement", state: "missing" }]);
});

ok("expired OPTIONAL document is not chased", () => {
  const items = collectNudgeItems({
    items: [
      {
        key: "opt",
        label: "Optional proof",
        required: false,
        status: "expired",
        documents: [{ status: "expired", rejectionReason: null }],
      },
    ],
  });
  assert.strictEqual(items.length, 0);
});

ok("received (awaiting review) is not re-asked", () => {
  const items = collectNudgeItems({
    items: [
      {
        key: "pan",
        label: "PAN card",
        required: true,
        status: "received",
        documents: [{ status: "received", rejectionReason: null }],
      },
    ],
  });
  assert.strictEqual(items.length, 0);
});

ok("email subject carries tenant + reference", () => {
  const { subject } = composeEmail([{ key: "pan", label: "PAN card", state: "missing" }], ctx);
  assert.strictEqual(subject, "Documents needed — Acme Loans — DKT-7F3K2M");
});

ok("email body lists items and re-ask reason", () => {
  const { text } = composeEmail(
    [
      { key: "pan", label: "PAN card", state: "missing" },
      { key: "aad", label: "Aadhaar", state: "rejected", reason: "blurry" },
    ],
    ctx,
  );
  assert.ok(text.includes("• PAN card"));
  assert.ok(text.includes("• Aadhaar — please re-send (blurry)"));
  assert.ok(text.includes("DKT-7F3K2M"));
  assert.ok(text.includes("keep the subject line unchanged"));
});

ok("email rejected item without reason omits the parenthetical", () => {
  const { text } = composeEmail([{ key: "aad", label: "Aadhaar", state: "rejected" }], ctx);
  assert.ok(text.includes("• Aadhaar — please re-send"));
  assert.ok(!text.includes("re-send ("));
});

ok("whatsapp params are the 4 body variables in order", () => {
  const p = composeWhatsappParams([{ key: "pan", label: "PAN card", state: "missing" }], ctx);
  assert.deepStrictEqual(p, ["Asha", "Acme Loans", "DKT-7F3K2M", "PAN card"]);
});

ok("whatsapp marks rejected items as re-send", () => {
  const p = composeWhatsappParams([{ key: "aad", label: "Aadhaar", state: "rejected" }], ctx);
  assert.strictEqual(p[3], "Aadhaar (re-send)");
});

ok("whatsapp item list truncates with an overflow tail under the cap", () => {
  const many = Array.from({ length: 100 }, (_, i) => ({
    key: `k${i}`,
    label: `Document number ${i} with a long name`,
    state: "missing",
  }));
  const p = composeWhatsappParams(many, ctx);
  assert.ok(p[3].length <= 600, `length was ${p[3].length}`);
  assert.ok(/…and \d+ more/.test(p[3]));
});

console.log(`\n${pass} passed`);
