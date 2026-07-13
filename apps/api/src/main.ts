import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });
  app.enableCors({ origin: true });
  const port = Number(process.env.API_PORT ?? 3333);
  await app.listen(port);
  console.log(`🚀 Docket API on http://localhost:${port}`);
}

bootstrap();
