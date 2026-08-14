import { memberMutationError, normalizeMemberTitle } from "../src/auth/team";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(
  memberMutationError({
    actorRole: "agent",
    actorUserId: "a",
    kind: "add",
    nextRole: "agent",
    ownerCount: 1,
  }) === "Only workspace owners and admins can change this.",
  "agents cannot add",
);

assert(
  memberMutationError({
    actorRole: "admin",
    actorUserId: "a",
    kind: "add",
    nextRole: "owner",
    ownerCount: 1,
  }) === "You cannot assign that role",
  "admins cannot mint owners",
);

assert(
  memberMutationError({
    actorRole: "owner",
    actorUserId: "a",
    kind: "add",
    nextRole: "agent",
    ownerCount: 1,
  }) === null,
  "owners can add agents",
);

assert(
  memberMutationError({
    actorRole: "owner",
    actorUserId: "a",
    targetUserId: "a",
    targetRole: "owner",
    kind: "remove",
    ownerCount: 2,
  }) === "You cannot remove yourself",
  "cannot remove self",
);

assert(
  memberMutationError({
    actorRole: "owner",
    actorUserId: "a",
    targetUserId: "b",
    targetRole: "owner",
    kind: "remove",
    ownerCount: 1,
  }) === "Cannot remove the last owner",
  "cannot remove last owner",
);

assert(
  memberMutationError({
    actorRole: "admin",
    actorUserId: "a",
    targetUserId: "b",
    targetRole: "owner",
    kind: "password",
    ownerCount: 2,
  }) === "Only a workspace owner can change another owner",
  "admins cannot reset owner passwords",
);

assert(normalizeMemberTitle("  Loan   officer  ") === "Loan officer", "title trims whitespace");
assert(normalizeMemberTitle("   ") === null, "blank title is null");
assert(normalizeMemberTitle(undefined) === null, "missing title is null");
assert(normalizeMemberTitle("x".repeat(50))?.length === 40, "title is capped");

console.log("team-policy ok");
