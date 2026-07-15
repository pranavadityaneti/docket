// Centralized, validated environment config. Importing this module has the
// side effect of validating the environment at boot and throwing if anything
// required is missing or unsafe — a crash on deploy is far better than a
// silently misconfigured (or insecure) server accepting traffic.

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProd = nodeEnv === "production";

// Comma-separated allow-list of web origins permitted by CORS.
// Required in production (never a wildcard in prod); optional in dev, where an
// unset value falls back to reflecting any origin for local convenience.
const webOriginRaw = process.env.WEB_ORIGIN?.trim();
if (isProd && !webOriginRaw) {
  throw new Error(
    "WEB_ORIGIN must be set in production (comma-separated list of allowed web origins).",
  );
}
const webOrigins = webOriginRaw
  ? webOriginRaw.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

export const env = {
  nodeEnv,
  isProd,
  apiPort: Number(process.env.API_PORT ?? 3333),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  webOrigins,
  /**
   * Value passed to `enableCors({ origin })`:
   *   - any WEB_ORIGIN set  -> that explicit allow-list
   *   - dev with none set   -> `true` (reflect any origin — local only)
   * In production WEB_ORIGIN is guaranteed present (validated above), so this
   * is always the explicit list there.
   */
  corsOrigin: webOrigins.length > 0 ? webOrigins : true,
} as const;
