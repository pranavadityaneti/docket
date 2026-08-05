import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express, { type NextFunction, type Request, type Response } from "express";
import "reflect-metadata";
import { hydrateSecrets } from "./config/secrets";

/** Uploads carry raw file bytes and must not be pre-parsed. */
const isUploadPath = (url: string) => url.startsWith("/uploads/");

async function bootstrap() {
  // Secrets FIRST. config/env validates the environment at import time and
  // app.module reads env.jwtSecret at module scope, so both are imported
  // dynamically below - a static import would evaluate them before Secrets
  // Manager had been consulted and the process would die on a missing
  // DATABASE_URL that was actually available all along.
  const loaded = await hydrateSecrets();
  if (loaded.length) console.log(`Loaded from Secrets Manager: ${loaded.join(", ")}`);

  const { env } = await import("./config/env");
  const { AppModule } = await import("./app.module");

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
    // Nest's default parsers are installed globally, which would consume the
    // request stream on the raw upload route before the handler can read it -
    // a file uploaded as application/json would silently arrive as 0 bytes.
    // Parsers are re-applied below for every path EXCEPT /uploads.
    bodyParser: false,
  });

  // WhatsApp webhook signatures (X-Hub-Signature-256) are an HMAC over the exact
  // raw request bytes. express.json() would hand the handler only the parsed
  // object, and re-serialising it will not reproduce Meta's byte stream (key
  // order, spacing), so the HMAC would never match. Stash the raw buffer on the
  // request for webhook paths only - the parser still runs, so @Body() keeps
  // working; we just also keep the bytes the signature was computed over.
  const captureRawBody = (req: Request, _res: Response, buf: Buffer) => {
    if (req.url.startsWith("/webhooks/")) {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    }
  };
  const jsonParser = express.json({ limit: "1mb", verify: captureRawBody });
  const formParser = express.urlencoded({ extended: true, limit: "1mb" });
  app.use((req: Request, res: Response, next: NextFunction) =>
    isUploadPath(req.url) ? next() : jsonParser(req, res, next),
  );
  app.use((req: Request, res: Response, next: NextFunction) =>
    isUploadPath(req.url) ? next() : formParser(req, res, next),
  );

  // In production we sit behind a load balancer (EB/ALB), so the client's real
  // IP arrives in X-Forwarded-For. Without trusting exactly one proxy hop,
  // express reports the balancer's IP for every request and per-IP rate
  // limiting silently degrades into a single shared bucket for the whole
  // internet. Only enabled in prod: trusting XFF when not behind a proxy would
  // let clients spoof their own IP.
  if (env.isProd) app.set("trust proxy", 1);

  app.enableCors({ origin: env.corsOrigin, credentials: true });
  // Reject malformed payloads at the edge: strip unknown fields, 400 on any
  // extra field, and coerce/validate declared fields against each DTO.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(env.apiPort);
  console.log(`🚀 Docket API on port ${env.apiPort} (${env.nodeEnv})`);
}

bootstrap();
