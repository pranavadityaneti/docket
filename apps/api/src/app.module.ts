import { Controller, Get, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { DbModule } from "./db/db";
import { AuthModule } from "./auth/auth";
import { LeadsModule } from "./leads/leads";
import { ContactsModule } from "./contacts/contacts";

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
      secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
      signOptions: { expiresIn: "7d" },
    }),
    DbModule,
    AuthModule,
    LeadsModule,
    ContactsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
