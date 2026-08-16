import {
  identityConflict,
  identityConflictMessage,
  loginIdError,
  normalizeLoginId,
} from "../../../packages/db/src/login-id.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(normalizeLoginId("  dpu-a12b3c4  ") === "DPU-A12B3C4", "normalizes case and trim");
assert(loginIdError("") === "User ID is required", "empty is required");
assert(loginIdError("priya.shah")?.includes("DPU-") === true, "rejects chosen usernames");
assert(loginIdError("DPU-A12B3C4") === null, "accepts issued user id");
assert(loginIdError("dpu-a12b3c4") === null, "accepts lowercase issued id");

assert(identityConflict(undefined, undefined) === null, "neither exists");
assert(identityConflict({ id: "1" }, { id: "1" }) === null, "same user");
assert(identityConflict({ id: "1" }, undefined) === "login_id", "login id taken");
assert(identityConflict(undefined, { id: "2" }) === "email", "email taken");
assert(identityConflict({ id: "1" }, { id: "2" }) === "mismatch", "split identity");
assert(
  identityConflictMessage("mismatch") === "User ID and email belong to different accounts",
  "mismatch copy",
);

console.log("login-id ok");
