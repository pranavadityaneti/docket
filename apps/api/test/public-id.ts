import {
  generatePublicId,
  isPublicId,
  normalizePublicId,
  publicIdError,
} from "../../../packages/db/src/public-id.ts";
import {
  generateCaseReference,
  normaliseCaseReference,
} from "../../../packages/db/src/reference.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

const userId = generatePublicId("user");
const tenantId = generatePublicId("tenant");
const caseId = generateCaseReference();

assert(/^DPU-[0-9A-Z]{7}$/.test(userId), "user id shape");
assert(/^DPT-[0-9A-Z]{7}$/.test(tenantId), "tenant id shape");
assert(/^DPC-[0-9A-Z]{7}$/.test(caseId), "case id shape");

assert(isPublicId("user", "dpu-a12b3c4") === true, "user id case-insensitive");
assert(isPublicId("tenant", "DPT-A12B3C4") === true, "tenant id");
assert(isPublicId("case", "DPC-A12B3C4") === true, "case id");
assert(isPublicId("user", "DPT-A12B3C4") === false, "wrong prefix");
assert(isPublicId("user", "priya.shah") === false, "chosen username rejected");

assert(normalizePublicId("  dpt-a12b3c4  ") === "DPT-A12B3C4", "normalize");
assert(publicIdError("user", "") === "User ID is required", "required");
assert(publicIdError("tenant", "nope")?.includes("DPT-") === true, "tenant shape copy");

assert(normaliseCaseReference("dpc-a12b3c4") === "DPC-A12B3C4", "case with prefix");
assert(normaliseCaseReference("A12B3C4") === "DPC-A12B3C4", "bare case body");
assert(normaliseCaseReference("DKT-7F3K2M") === "DKT-7F3K2M", "legacy DKT still parses");
assert(normaliseCaseReference("nope") === null, "rejects junk");

console.log("public-id ok");
