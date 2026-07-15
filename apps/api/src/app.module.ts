import { Controller, Get, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { env } from "./config/env";
import { DbModule } from "./db/db";
import { AuthModule } from "./auth/auth";
import { LeadsModule } from "./leads/leads";
import { ContactsModule } from "./contacts/contacts";
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
    DbModule,
    AuthModule,
    LeadsModule,
    ContactsModule,
    WorkflowsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
