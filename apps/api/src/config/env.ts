// Centralized, validated environment config. Importing this module has the
// side effect of validating the environment at boot and throwing if anything
// required is missing or unsafe - a crash on deploy is far better than a
// silently misconfigured (or insecure) server accepting traffic.

import { isAllowedWebOrigin } from "./tenant-host";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProd = nodeEnv === "production";

// Comma-separated allow-list of web origins permitted by CORS.
// Required in production as a *seed* list (legacy hosts / vercel.app). Tenant
// subdomains (<slug>.finlot.ai, <slug>-uat.finlot.ai, <slug>.docket.in) are
// also allowed via isAllowedWebOrigin - never a bare `*`, credentials need a
// real allow check. Optional in dev = reflect any origin for local convenience.
const webOriginRaw = process.env.WEB_ORIGIN?.trim();
if (isProd && !webOriginRaw) {
  throw new Error(
    "WEB_ORIGIN must be set in production (comma-separated list of allowed web origins).",
  );
}
const webOrigins = webOriginRaw
  ? webOriginRaw.split(",").map((o) => o.trim()).filter(Boolean)
  : [];

// Where documents are stored. "local" writes to disk and is development only -
// it cannot presign, it keeps upload tickets in process memory, and nothing
// survives a restart. Production must be "s3" (Change 3b), so a prod boot on
// the local driver is refused rather than silently writing borrower KYC to an
// ephemeral EC2 filesystem that vanishes on the next deploy.
const storageDriver = (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3";
if (isProd && storageDriver === "local") {
  throw new Error(
    "STORAGE_DRIVER=local is development only - documents would be lost on redeploy. Set STORAGE_DRIVER=s3 in production.",
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
   * encryption already applies it - naming it explicitly means a misconfigured
   * bucket cannot silently downgrade what this API writes.
   */
  s3KmsKeyId: process.env.S3_KMS_KEY_ID?.trim() || undefined,
  awsRegion: process.env.AWS_REGION?.trim() || "ap-south-1",
  /**
   * This API's own externally reachable base URL. The local driver hands the
   * client an upload URL pointing back here, so it must be what the browser can
   * actually reach - not localhost, if the API sits behind a proxy.
   */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.API_PORT ?? 3333}`)
    .replace(/\/+$/, ""),
  /** Hard ceiling on a single uploaded file. */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024),
  /**
   * Value passed to `enableCors({ origin })`:
   *   - WEB_ORIGIN set (prod) → callback allowing explicit list + slug hosts
   *   - dev with none set     → `true` (reflect any origin - local only)
   */
  corsOrigin:
    webOrigins.length > 0
      ? (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          if (!origin) {
            cb(null, true);
            return;
          }
          cb(null, isAllowedWebOrigin(origin, webOrigins));
        }
      : true,
  /**
   * Template for per-tenant dashboard origins in email links, e.g.
   * `https://{slug}-uat.finlot.ai` or `https://{slug}.finlot.ai`.
   * When unset, inferred from the request Origin / tenantSlug at send time.
   */
  tenantOriginTemplate: process.env.TENANT_ORIGIN_TEMPLATE?.trim() || undefined,
  /**
   * Resend credentials for transactional email (password reset). Optional: when
   * either is unset the email module logs and no-ops, so dev and tests run
   * without email. Supplied in prod via the Secrets Manager secret.
   */
  resendApiKey: process.env.RESEND_API_KEY?.trim() || undefined,
  resendFromEmail: process.env.RESEND_FROM_EMAIL?.trim() || undefined,
  /**
   * Key that encrypts tenant channel credentials at rest (see secret-box.ts).
   * Optional in dev; when unset the channels feature refuses to store or read a
   * credential rather than doing it in the clear. Supplied in prod via the
   * Secrets Manager secret.
   */
  channelSecretKey: process.env.CHANNEL_SECRET_KEY?.trim() || undefined,
  /**
   * Verify token for the WhatsApp webhook GET handshake. Global (not per-tenant)
   * because Meta verifies the callback URL when the webhook is configured -
   * before any channel row with credentials exists. Per-tenant app secrets still
   * gate every inbound POST. A future multi-app setup would move to per-path
   * webhooks; one token is right while there is one Meta app.
   */
  whatsappVerifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() || undefined,
  /** Meta Graph API version used for media download. */
  graphApiVersion: process.env.GRAPH_API_VERSION?.trim() || "v25.0",
  /**
   * OpenAI credentials for document classification. Optional: when unset the
   * classifier no-ops and every arrival stays wherever it lands today — the
   * feature degrades to "off", never to "broken". Supplied in prod via the
   * Secrets Manager secret.
   */
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  /** Overridable so a model swap is an env change, not a redeploy. */
  openaiModel: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  /**
   * Fallback app origin when a tenant slug / request Origin is unavailable
   * (legacy single-host). Prefer originForSlug / matchTenantHost at call sites.
   */
  appOrigin: webOrigins[0] ?? "http://localhost:3000",
  /**
   * Shared key for the machine-intake endpoint (the marketing site's enquiry
   * form). Optional: unset means intake answers 503 - off, never open.
   */
  intakeApiKey: process.env.INTAKE_API_KEY?.trim() || undefined,
  /** The single tenant intake creates cases for. See intake.ts on why one. */
  intakeTenantSlug: process.env.INTAKE_TENANT_SLUG?.trim() || "finlot",
} as const;
