import { cases, contacts } from "@docket/db";
import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsUUID } from "class-validator";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { DbService } from "../db/db";

/**
 * The parties documents are collected FROM, across all their cases.
 *
 * The case count rides along because a bare name-and-email list answers
 * nothing a person actually asks. The question this screen exists for is
 * "have we dealt with them before, and where?" - which is what makes a
 * reusable document reusable.
 */
export class BulkContactIdsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID("4", { each: true })
  ids!: string[];
}

@Injectable()
export class ContactsService {
  constructor(private readonly db: DbService) { }

  list(tenantId: string, opts: { limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    return this.db.withTenant(tenantId, async (tx) => {
      const where = isNull(contacts.deletedAt);
      const [countRow] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(contacts)
        .where(where);
      const items = await tx
        .select({
          id: contacts.id,
          kind: contacts.kind,
          name: contacts.name,
          organisation: contacts.organisation,
          email: contacts.email,
          phone: contacts.phone,
          createdAt: contacts.createdAt,
          caseCount: sql<number>`count(${cases.id})::int`,
          lastCaseAt: sql<Date | null>`max(${cases.createdAt})`,
        })
        .from(contacts)
        .leftJoin(cases, and(eq(cases.contactId, contacts.id), isNull(cases.deletedAt)))
        .where(where)
        .groupBy(contacts.id)
        .orderBy(desc(contacts.createdAt))
        .limit(limit)
        .offset(offset);
      return { items, total: countRow?.total ?? 0, limit, offset };
    });
  }

  /**
   * What deleting these contacts would mean. A contact holding live cases is
   * refused here rather than at save time, so the confirmation can say which
   * ones and why instead of failing after the user has committed.
   */
  preview(tenantId: string, ids: string[]) {
    return this.db.withTenant(tenantId, async (tx) => {
      if (ids.length === 0) return [];
      return tx
        .select({
          id: contacts.id,
          name: contacts.name,
          caseCount: sql<number>`count(${cases.id})::int`,
        })
        .from(contacts)
        .leftJoin(cases, and(eq(cases.contactId, contacts.id), isNull(cases.deletedAt)))
        .where(and(inArray(contacts.id, ids), isNull(contacts.deletedAt)))
        .groupBy(contacts.id);
    });
  }

  /**
   * Soft-delete contacts, refusing any that still hold live cases.
   *
   * Refusing is the honest option: cascading would delete a borrower's cases
   * as a side effect of tidying a contact list, and orphaning would leave
   * cases whose subject cannot be named - and whose inbound documents would
   * have nothing to match against.
   */
  async deleteMany(tenantId: string, userId: string, ids: string[]) {
    return this.db.withTenant(tenantId, async (tx) => {
      const deleted: string[] = [];
      const refused: { id: string; reason: string }[] = [];
      const now = new Date();

      for (const id of ids) {
        const [live] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(cases)
          .where(and(eq(cases.contactId, id), isNull(cases.deletedAt)));
        if ((live?.n ?? 0) > 0) {
          refused.push({
            id,
            reason: `Still has ${live.n} case${live.n === 1 ? "" : "s"} - delete or reassign those first`,
          });
          continue;
        }
        const [row] = await tx
          .update(contacts)
          .set({ deletedAt: now, deletedBy: userId })
          .where(and(eq(contacts.id, id), isNull(contacts.deletedAt)))
          .returning({ id: contacts.id });
        if (!row) {
          refused.push({ id, reason: "Not found, or already deleted" });
          continue;
        }
        deleted.push(id);
      }
      return { deleted, refused };
    });
  }
}

@Controller("contacts")
@UseGuards(JwtAuthGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) { }

  @Get()
  list(
    @CurrentUser() u: AuthUser,
    @Query("limit") limitRaw?: string,
    @Query("offset") offsetRaw?: string,
  ) {
    const limit = limitRaw !== undefined ? Number(limitRaw) : undefined;
    const offset = offsetRaw !== undefined ? Number(offsetRaw) : undefined;
    return this.contacts.list(u.tenantId, {
      limit: Number.isFinite(limit) ? limit : undefined,
      offset: Number.isFinite(offset) ? offset : undefined,
    });
  }

  @Post("delete-preview")
  preview(@CurrentUser() u: AuthUser, @Body() body: BulkContactIdsDto) {
    return this.contacts.preview(u.tenantId, body.ids);
  }

  @Post("delete")
  deleteMany(@CurrentUser() u: AuthUser, @Body() body: BulkContactIdsDto) {
    return this.contacts.deleteMany(u.tenantId, u.userId, body.ids);
  }
}

@Module({ controllers: [ContactsController], providers: [ContactsService] })
export class ContactsModule { }
