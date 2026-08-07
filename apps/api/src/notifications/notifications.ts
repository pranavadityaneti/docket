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
import { and, count, desc, eq, isNull, or } from "drizzle-orm";
import { IsBoolean, IsIn, IsOptional } from "class-validator";
import { Transform } from "class-transformer";
import { AuthModule, CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { DbService } from "../db/db";

export class ListNotificationsQuery {
  @IsOptional()
  @Transform(({ value }) => value === "true" || value === true)
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn([...NOTIFICATION_KINDS])
  kind?: (typeof NOTIFICATION_KINDS)[number];
}

@Injectable()
export class NotificationsService {
  constructor(private readonly db: DbService) {}

  /**
   * Newest first. Workspace-wide rows (user_id null) plus this user's own.
   * Soft-deleted cases still keep their notification via ON DELETE SET NULL
   * on case_id - the href may 404, which is honest.
   */
  list(tenantId: string, userId: string, opts: ListNotificationsQuery = {}) {
    return this.db.withTenant(tenantId, async (tx) => {
      const audience = or(
        isNull(notifications.userId),
        eq(notifications.userId, userId),
      );
      const filters = [audience];
      if (opts.unreadOnly) filters.push(isNull(notifications.readAt));
      if (opts.kind) filters.push(eq(notifications.kind, opts.kind));

      return tx
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
        .where(and(...filters))
        .orderBy(desc(notifications.createdAt))
        .limit(100);
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
