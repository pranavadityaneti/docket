import "reflect-metadata";
import { env } from "./config/env";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express, { type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./app.module";

/** Uploads carry raw file bytes and must not be pre-parsed. */
const isUploadPath = (url: string) => url.startsWith("/uploads/");

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
    // Nest's default parsers are installed globally, which would consume the
    // request stream on the raw upload route before the handler can read it —
    // a file uploaded as application/json would silently arrive as 0 bytes.
    // Parsers are re-applied below for every path EXCEPT /uploads.
    bodyParser: false,
  });

  const jsonParser = express.json({ limit: "1mb" });
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
