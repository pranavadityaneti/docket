import { Controller, Get, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { env } from "./config/env";
import { DbModule } from "./db/db";
import { AuthModule } from "./auth/auth";
import { CasesModule } from "./cases/cases";
import { DocumentsModule } from "./documents/documents";
import { StorageModule } from "./storage/storage";
import { ContactsModule } from "./contacts/contacts";
import { WorkflowsModule } from "./workflows/workflows";
import { OverviewModule } from "./overview/overview";
import { ChannelsModule } from "./channels/channels";
import { NudgesModule } from "./nudges/nudges";
import { UnmatchedModule } from "./unmatched/unmatched";
import { IntakeModule } from "./intake/intake";
import { ActivityModule } from "./activity/activity";

@Controller("health")
class HealthController {
  @Get()
  ok() {
    return { ok: true, service: "docket-api" };
  }
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: env.jwtSecret,
      signOptions: { expiresIn: "7d" },
    }),
    // Baseline bucket (ttl in ms). Routes that need to be stricter — /auth/login
    // in particular — override this with @Throttle. Only controllers that opt in
    // via ThrottlerGuard are actually limited.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DbModule,
    AuthModule,
    StorageModule,
    CasesModule,
    DocumentsModule,
    ContactsModule,
    WorkflowsModule,
    OverviewModule,
    ChannelsModule,
    NudgesModule,
    UnmatchedModule,
    IntakeModule,
    ActivityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
