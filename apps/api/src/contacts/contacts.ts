import { Controller, Get, Injectable, Module, UseGuards } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import { cases, contacts } from "@docket/db";
import { DbService } from "../db/db";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";

/**
 * The parties documents are collected FROM, across all their cases.
 *
 * The case count rides along because a bare name-and-email list answers
 * nothing a person actually asks. The question this screen exists for is
 * "have we dealt with them before, and where?" — which is what makes a
 * reusable document reusable.
 */
@Injectable()
export class ContactsService {
  constructor(private readonly db: DbService) {}

  list(tenantId: string) {
    return this.db.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: contacts.id,
          kind: contacts.kind,
          name: contacts.name,
          organisation: contacts.organisation,
          email: contacts.email,
          phone: contacts.phone,
          createdAt: contacts.createdAt,
          // LEFT JOIN + count: a contact with no case yet is still a contact,
          // and must not vanish from its own list.
          caseCount: sql<number>`count(${cases.id})::int`,
          lastCaseAt: sql<Date | null>`max(${cases.createdAt})`,
        })
        .from(contacts)
        .leftJoin(cases, eq(cases.contactId, contacts.id))
        .groupBy(contacts.id)
        .orderBy(desc(contacts.createdAt)),
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
