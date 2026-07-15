import "reflect-metadata";
import { env } from "./config/env";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
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
