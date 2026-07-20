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

// Where documents are stored. "local" writes to disk and is development only —
// it cannot presign, it keeps upload tickets in process memory, and nothing
// survives a restart. Production must be "s3" (Change 3b), so a prod boot on
// the local driver is refused rather than silently writing borrower KYC to an
// ephemeral EC2 filesystem that vanishes on the next deploy.
const storageDriver = (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3";
if (isProd && storageDriver === "local") {
  throw new Error(
    "STORAGE_DRIVER=local is development only — documents would be lost on redeploy. Set STORAGE_DRIVER=s3 in production.",
  );
}
// Fail at boot, not on the first upload. A server that starts happily and then
// cannot store a borrower's documents is worse than one that refuses to start.
const s3Bucket = process.env.S3_BUCKET?.trim();
if (storageDriver === "s3" && !s3Bucket) {
  throw new Error("S3_BUCKET must be set when STORAGE_DRIVER=s3.");
}

export const env = {
  nodeEnv,
  isProd,
  apiPort: Number(process.env.API_PORT ?? 3333),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  webOrigins,
  storageDriver,
  /** Root directory for the local driver. Ignored when storageDriver is "s3". */
  storageLocalRoot: process.env.STORAGE_LOCAL_ROOT ?? "/tmp/docket-storage",
  /** Bucket holding subject documents. Required when storageDriver is "s3". */
  s3Bucket: s3Bucket ?? "",
  /**
   * Customer-managed KMS key. Optional in the sense that the bucket's default
   * encryption already applies it — naming it explicitly means a misconfigured
   * bucket cannot silently downgrade what this API writes.
   */
  s3KmsKeyId: process.env.S3_KMS_KEY_ID?.trim() || undefined,
  awsRegion: process.env.AWS_REGION?.trim() || "ap-south-1",
  /**
   * This API's own externally reachable base URL. The local driver hands the
   * client an upload URL pointing back here, so it must be what the browser can
   * actually reach — not localhost, if the API sits behind a proxy.
   */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.API_PORT ?? 3333}`)
    .replace(/\/+$/, ""),
  /** Hard ceiling on a single uploaded file. */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024),
  /**
   * Value passed to `enableCors({ origin })`:
   *   - any WEB_ORIGIN set  -> that explicit allow-list
   *   - dev with none set   -> `true` (reflect any origin — local only)
   * In production WEB_ORIGIN is guaranteed present (validated above), so this
   * is always the explicit list there.
   */
  corsOrigin: webOrigins.length > 0 ? webOrigins : true,
  /**
   * Resend credentials for transactional email (password reset). Optional: when
   * either is unset the email module logs and no-ops, so dev and tests run
   * without email. Supplied in prod via the Secrets Manager secret.
   */
  resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
  resendFromEmail: process.env.RESEND_FROM_EMAIL?.trim() || undefined,
  /**
   * Canonical app origin for links we email (e.g. the reset link). The first
   * WEB_ORIGIN entry in prod (the dashboard's own origin); localhost in dev
   * where WEB_ORIGIN is unset. Never taken from request input.
   */
  appOrigin: webOrigins[0] ?? "http://localhost:3000",
} as const;
