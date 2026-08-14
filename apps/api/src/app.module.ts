import { Controller, Get, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ThrottlerModule } from "@nestjs/throttler";
import { ActivityModule } from "./activity/activity";
import { AuthModule } from "./auth/auth";
import { CasesModule } from "./cases/cases";
import { ChannelsModule } from "./channels/channels";
import { env } from "./config/env";
import { ContactsModule } from "./contacts/contacts";
import { DbModule } from "./db/db";
import { DocumentsModule } from "./documents/documents";
import { IntakeModule } from "./intake/intake";
import { NudgesModule } from "./nudges/nudges";
import { NotificationsModule } from "./notifications/notifications";
import { OverviewModule } from "./overview/overview";
import { PlatformModule } from "./platform/platform";
import { StorageModule } from "./storage/storage";
import { UnmatchedModule } from "./unmatched/unmatched";
import { WorkflowsModule } from "./workflows/workflows";

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
    // Baseline bucket (ttl in ms). Routes that need to be stricter - /auth/login
    // in particular - override this with @Throttle. Only controllers that opt in
    // via ThrottlerGuard are actually limited.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DbModule,
    AuthModule,
    PlatformModule,
    StorageModule,
    CasesModule,
    DocumentsModule,
    ContactsModule,
    WorkflowsModule,
    OverviewModule,
    ChannelsModule,
    NudgesModule,
    NotificationsModule,
    UnmatchedModule,
    IntakeModule,
    ActivityModule,
  ],
  controllers: [HealthController],
})
export class AppModule { }
