import { Controller, Get, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
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

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  throw new Error("JWT_SECRET is not set — refusing to start with an insecure default.");
}

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: jwtSecret,
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
