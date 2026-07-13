import { Controller, Get, Injectable, Module, UseGuards } from "@nestjs/common";
import { desc } from "drizzle-orm";
import { contacts } from "@docket/db";
import { DbService } from "../db/db";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";

@Injectable()
export class ContactsService {
  constructor(private readonly db: DbService) {}

  list(tenantId: string) {
    return this.db.withTenant(tenantId, (tx) =>
      tx.select().from(contacts).orderBy(desc(contacts.createdAt)),
    );
  }
}

@Controller("contacts")
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.contacts.list(u.tenantId);
  }
}

@Module({ controllers: [ContactsController], providers: [ContactsService] })
export class ContactsModule {}
