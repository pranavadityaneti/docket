import { resendFrom } from "../src/email/from.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(
  resendFrom("Docket", "no-reply@updates.finlot.ai") ===
    "Docket <no-reply@updates.finlot.ai>",
  "password-reset From uses RESEND_FROM_EMAIL",
);
assert(
  resendFrom("Acme Loans", "no-reply@updates.finlot.ai") ===
    "Acme Loans <no-reply@updates.finlot.ai>",
  "nudge From uses the same RESEND_FROM_EMAIL",
);

console.log("email-from: ok");
