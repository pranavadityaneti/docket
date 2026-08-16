/** Postgres SQLSTATE is five digits (`23505`, `42501`, …). */
const SQLSTATE = /^\d{5}$/;

export type PostgresErrorInfo = {
  code: string;
  message: string;
  constraint: string;
  detail: string;
};

/**
 * Drizzle wraps the driver error as `Failed query: …` and hides `code` on
 * `cause`. Walk a few levels so callers can map unique violations, RLS, etc.
 */
export function postgresErrorInfo(err: unknown): PostgresErrorInfo | null {
  let current: unknown = err;
  for (let i = 0; i < 8 && current && typeof current === "object"; i++) {
    const rec = current as Record<string, unknown>;
    if (typeof rec.code === "string" && SQLSTATE.test(rec.code)) {
      return {
        code: rec.code,
        message: typeof rec.message === "string" ? rec.message : String(err),
        constraint: String(rec.constraint ?? rec.constraint_name ?? ""),
        detail: typeof rec.detail === "string" ? rec.detail : "",
      };
    }
    current = rec.cause;
  }
  return null;
}
