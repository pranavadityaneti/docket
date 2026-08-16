import { postgresErrorInfo } from "../../../packages/db/src/pg-error.ts";

function assert(cond: unknown, message: string) {
  if (!cond) throw new Error(message);
}

assert(postgresErrorInfo(new Error("plain")) === null, "non-pg errors are null");

const wrapped = new Error("Failed query: insert into tenants");
(wrapped as Error & { cause: unknown }).cause = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "tenants_slug_unique"',
  constraint_name: "tenants_slug_unique",
  detail: "Key (slug)=(test-tenant) already exists.",
};

const info = postgresErrorInfo(wrapped);
assert(info?.code === "23505", "unwraps drizzle cause");
assert(info?.constraint === "tenants_slug_unique", "reads constraint_name");
assert(info?.detail.includes("test-tenant") === true, "keeps detail");

console.log("pg-error ok");
