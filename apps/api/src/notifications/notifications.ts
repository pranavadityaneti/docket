import { notifications, NOTIFICATION_KINDS } from "@docket/db";
import {
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { and, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { AuthModule, CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { clampPage, type PageOpts } from "../common/pagination";
import { DbService } from "../db/db";

/** Escape \, %, _ so user search terms stay literal in ILIKE patterns. */
function likeContains(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export class ListNotificationsQuery {
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn([...NOTIFICATION_KINDS])
  kind?: (typeof NOTIFICATION_KINDS)[number];

  /** Case-insensitive match on title, body, or kind. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  /**
   * Best-effort write used by intake paths. Never throws to the caller — a
   * failed bell entry must never cost a landed message or document.
   */
  async notify(
    tenantId: string,
    input: {
      kind: (typeof NOTIFICATION_KINDS)[number];
      title: string;
      body?: string | null;
      href?: string | null;
      caseId?: string | null;
      userId?: string | null;
    },
  ): Promise<void> {
    try {
      await this.db.withTenant(tenantId, async (tx) => {
        await tx.insert(notifications).values({
          tenantId,
          kind: input.kind,
          title: input.title,
          body: input.body ?? null,
          href: input.href ?? null,
          caseId: input.caseId ?? null,
          userId: input.userId ?? null,
        });
      });
    } catch {
      // Swallow: intake callers fire-and-forget.
    }
  }

  /**
   * Newest first. Workspace-wide rows (user_id null) plus this user's own.
   * Soft-deleted cases still keep their notification via ON DELETE SET NULL
   * on case_id - the href may 404, which is honest.
   */
  list(tenantId: string, userId: string, opts: ListNotificationsQuery = {}) {
    const { limit, offset } = clampPage(opts as PageOpts);
    return this.db.withTenant(tenantId, async (tx) => {
      const audience = or(
        isNull(notifications.userId),
        eq(notifications.userId, userId),
      );
      const filters = [audience];
      if (opts.unreadOnly) filters.push(isNull(notifications.readAt));
      if (opts.kind) filters.push(eq(notifications.kind, opts.kind));
      if (opts.q) {
        const pattern = likeContains(opts.q);
        // ESCAPE '\' so escaped \%, _, \ from likeContains stay literal.
        filters.push(
          or(
            sql`${notifications.title} ilike ${pattern} escape '\\'`,
            sql`coalesce(${notifications.body}, '') ilike ${pattern} escape '\\'`,
            sql`${notifications.kind} ilike ${pattern} escape '\\'`,
          )!,
        );
      }
      const where = and(...filters);

      const [countRow] = await tx
        .select({ total: count() })
        .from(notifications)
        .where(where);

      const items = await tx
        .select({
          id: notifications.id,
          kind: notifications.kind,
          title: notifications.title,
          body: notifications.body,
          href: notifications.href,
          caseId: notifications.caseId,
          readAt: notifications.readAt,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset);

      return {
        items,
        total: Number(countRow?.total ?? 0),
        limit,
        offset,
      };
    });
  }

  unreadCount(tenantId: string, userId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ n: count() })
        .from(notifications)
        .where(
          and(
            isNull(notifications.readAt),
            or(isNull(notifications.userId), eq(notifications.userId, userId)),
          ),
        );
      return { count: Number(row?.n ?? 0) };
    });
  }

  markRead(tenantId: string, userId: string, id: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const audience = and(
        eq(notifications.id, id),
        or(isNull(notifications.userId), eq(notifications.userId, userId)),
      );
      const [existing] = await tx
        .select({
          id: notifications.id,
          readAt: notifications.readAt,
        })
        .from(notifications)
        .where(audience)
        .limit(1);
      if (!existing) throw new NotFoundException("Notification not found");
      if (existing.readAt) return existing;

      const [row] = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(eq(notifications.id, id))
        .returning({
          id: notifications.id,
          readAt: notifications.readAt,
        });
      return row!;
    });
  }

  markAllRead(tenantId: string, userId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const updated = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            isNull(notifications.readAt),
            or(isNull(notifications.userId), eq(notifications.userId, userId)),
          ),
        )
        .returning({ id: notifications.id });
      return { updated: updated.length };
    });
  }

  /** Clear unread bell items for one case (e.g. staff opened its Conversations tab). */
  markCaseRead(tenantId: string, userId: string, caseId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const updated = await tx
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.caseId, caseId),
            isNull(notifications.readAt),
            or(isNull(notifications.userId), eq(notifications.userId, userId)),
          ),
        )
        .returning({ id: notifications.id });
      return { updated: updated.length };
    });
  }
}

@Controller("notifications")
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() query: ListNotificationsQuery) {
    return this.notifications.list(u.tenantId, u.userId, query);
  }

  @Get("unread-count")
  unreadCount(@CurrentUser() u: AuthUser) {
    return this.notifications.unreadCount(u.tenantId, u.userId);
  }

  @Post("read-all")
  markAllRead(@CurrentUser() u: AuthUser) {
    return this.notifications.markAllRead(u.tenantId, u.userId);
  }

  @Post("case/:caseId/read")
  markCaseRead(
    @CurrentUser() u: AuthUser,
    @Param("caseId", ParseUUIDPipe) caseId: string,
  ) {
    return this.notifications.markCaseRead(u.tenantId, u.userId, caseId);
  }

  @Post(":id/read")
  markRead(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(u.tenantId, u.userId, id);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
