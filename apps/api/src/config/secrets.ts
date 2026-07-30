import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

/**
 * Load configuration secrets from AWS Secrets Manager into process.env.
 *
 * WHY THIS EXISTS
 * Elastic Beanstalk environment properties are encrypted at rest, but any IAM
 * principal with `elasticbeanstalk:DescribeConfigurationSettings` can read them
 * back in plaintext — the database password and the JWT signing key included.
 * That is tolerable for a solo account with no data; it is not tolerable once
 * the database holds borrower KYC, and it is not something to explain to an
 * auditor. Secrets Manager scopes access to a named secret, logs every read in
 * CloudTrail, and can be rotated without redeploying.
 *
 * WHY IT WRITES INTO process.env RATHER THAN RETURNING VALUES
 * config/env.ts validates the environment at import time, and modules like
 * app.module.ts consume `env.jwtSecret` at module scope. Making the whole chain
 * async would mean rewriting the boot path of every module. Instead this runs
 * FIRST, populates process.env, and main.ts imports AppModule dynamically
 * afterwards — so by the time anything reads env, the values are already there.
 *
 * Values already present in the environment win. That keeps local development
 * and tests working with no AWS credentials at all, and gives an operator a
 * documented escape hatch during an incident.
 */

const REGION = process.env.AWS_REGION?.trim() || "ap-south-1";

/** Keys we are willing to take from a secret. Anything else is ignored. */
const ALLOWED = new Set([
  "DATABASE_URL",
  "JWT_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "CHANNEL_SECRET_KEY",
  "WHATSAPP_VERIFY_TOKEN",
  "OPENAI_API_KEY",
  // Without this the advertised "swap the model with an env var" is only half
  // true: env.ts reads it, but nothing in prod could supply it.
  "OPENAI_MODEL",
]);

export async function hydrateSecrets(): Promise<string[]> {
  const secretId = process.env.APP_SECRET_ID?.trim();
  if (!secretId) return [];

  const client = new SecretsManagerClient({ region: REGION });
  const res = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) {
    throw new Error(`Secret ${secretId} has no SecretString — refusing to start.`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(res.SecretString);
  } catch {
    throw new Error(`Secret ${secretId} is not valid JSON — refusing to start.`);
  }

  const loaded: string[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!ALLOWED.has(key)) continue;
    if (typeof value !== "string" || value.trim() === "") continue;
    // An explicitly-set environment variable wins, so a deploy can override
    // one value without editing the secret.
    if (process.env[key]?.trim()) continue;
    process.env[key] = value;
    loaded.push(key);
  }
  // Names only. The values are the entire point of this module.
  return loaded;
}
