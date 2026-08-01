import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { and, asc, desc, eq } from "drizzle-orm";
import {
  caseEvents,
  caseMessages,
  cases,
  conversationMessages,
  contacts,
  documentRequirements,
  generateCaseReference,
  SUBJECT_KINDS,
  users,
  workflows,
  workflowStages,
  type SubjectKind,
} from "@docket/db";
import { DbService } from "../db/db";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { NudgesModule, NudgeService } from "../nudges/nudges";

/**
 * A case is one run of a workflow: a loan application, a college admission, an
 * audit engagement, an insurance claim. Nothing in this module names an
 * industry — the subject's own fields live in `data` and are described by the
 * workflow's field config, so adding a vertical is configuration, not code.
 */

// Guard on the JSONB payload: without a bound, a client could push an
// arbitrarily large document into a column we read on every list. Measured in
// UTF-8 bytes, not string length — Indian names and the rupee sign are
// multi-byte, so `.length` would let through several times this budget.
const MAX_DATA_BYTES = 16_000;

const MAX_REFERENCE_ATTEMPTS = 5;

/**
 * The PostgreSQL SQLSTATE for a failed query.
 *
 * drizzle wraps driver errors in a DrizzleQueryError, so the code is NOT on the
 * error itself — `err.code` is undefined and the real code sits on `err.cause`.
 * Checking only the top level silently never matches, which turns any
 * error-code branch into dead code. Both levels are read so this keeps working
 * if drizzle stops wrapping.
 */
function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.cause?.code ?? e?.code;
}

export class CreateCaseDto {
  /** The subject: borrower, student, client, vendor — whoever we collect from. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  /** Whether the subject is a person or an organisation. Defaults to person. */
  @IsOptional()
  @IsIn([...SUBJECT_KINDS])
  kind?: SubjectKind;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organisation?: string;

  // Email and phone are how inbound documents get routed back to this case,
  // so they matter far more here than they did for a sales lead.
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  workflow?: string;

  /** Domain fields, per the workflow's field config (loan_amount, course, claim_no…). */
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

/**
 * Edit a case's own details. Every field optional: the client sends only what
 * changed. `data` is MERGED into the existing object, so one screen editing
 * two fields cannot wipe values another screen wrote.
 *
 * Deliberately NOT editable here: reference (the handle quoted in every email
 * the subject has), workflow (its checklist is already built and its
 * requirements already reference it), stage and reminders — each of those has
 * its own endpoint and its own audit line.
 */
export class UpdateCaseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  organisation?: string;

  // Nullable so a wrong address can be CLEARED, not just replaced — an empty
  // string arrives as null rather than an address of "".
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string | null;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class UpdateStageDto {
  @IsUUID()
  stageId!: string;
}

export class AddCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  body!: string;

  /** Pin the note to one checklist item — "special instructions on THIS document". */
  @IsOptional()
  @IsUUID()
  requirementId?: string;
}

@Injectable()
export class CasesService {
  private readonly log = new Logger(CasesService.name);

  constructor(
    private readonly db: DbService,
    private readonly nudges: NudgeService,
  ) {}

  /**
   * Resolve which workflow a request means. An explicit slug wins; otherwise,
   * if the tenant runs exactly one workflow, use it. Deliberately no default
   * slug — hardcoding "business-loan" here is what made this a lending tool.
   */
  private async resolveWorkflow(tx: any, slug?: string) {
    if (slug) {
      const [wf] = await tx.select().from(workflows).where(eq(workflows.slug, slug)).limit(1);
      if (!wf) throw new NotFoundException(`Workflow "${slug}" not found`);
      return wf;
    }
    // RLS already scopes this to the tenant.
    const all = await tx.select().from(workflows).limit(2);
    if (all.length === 1) return all[0];
    if (all.length === 0) throw new NotFoundException("This workspace has no workflows yet");
    throw new BadRequestException("workflow is required when a workspace has more than one");
  }

  list(tenantId: string, workflowSlug?: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const wf = await this.resolveWorkflow(tx, workflowSlug);
      return tx
        .select({
          id: cases.id,
          reference: cases.reference,
          source: cases.source,
          data: cases.data,
          createdAt: cases.createdAt,
          updatedAt: cases.updatedAt,
          subjectName: contacts.name,
          subjectOrganisation: contacts.organisation,
          subjectEmail: contacts.email,
          subjectPhone: contacts.phone,
          stageId: workflowStages.id,
          stageName: workflowStages.name,
          stageTone: workflowStages.tone,
        })
        .from(cases)
        .leftJoin(contacts, eq(cases.contactId, contacts.id))
        .leftJoin(workflowStages, eq(cases.stageId, workflowStages.id))
        .where(eq(cases.workflowId, wf.id))
        .orderBy(desc(cases.createdAt));
    });
  }

  /**
   * One case, with the vocabulary of the workflow it actually belongs to.
   *
   * The workflow is joined, not resolved from a slug and not taken as "the
   * tenant's first workflow". A detail screen that guessed would label a
   * student "Borrower" the moment a tenant runs two workflows — the same class
   * of bug that made `listStages` silently default to a lending slug.
   */
  get(tenantId: string, caseId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({
          id: cases.id,
          reference: cases.reference,
          source: cases.source,
          data: cases.data,
          nudgesPausedAt: cases.nudgesPausedAt,
          createdAt: cases.createdAt,
          updatedAt: cases.updatedAt,
          subjectName: contacts.name,
          subjectOrganisation: contacts.organisation,
          subjectEmail: contacts.email,
          subjectPhone: contacts.phone,
          stageId: workflowStages.id,
          stageName: workflowStages.name,
          stageTone: workflowStages.tone,
          workflowId: workflows.id,
          workflowName: workflows.name,
          workflowSlug: workflows.slug,
          subjectLabel: workflows.subjectLabel,
          caseLabel: workflows.caseLabel,
        })
        .from(cases)
        .innerJoin(workflows, eq(cases.workflowId, workflows.id))
        .leftJoin(contacts, eq(cases.contactId, contacts.id))
        .leftJoin(workflowStages, eq(cases.stageId, workflowStages.id))
        .where(eq(cases.id, caseId))
        .limit(1);
      // RLS already confines this to the tenant, so a miss is genuinely "not
      // here" — there is no path by which this returns another tenant's case.
      if (!row) throw new NotFoundException("Case not found");
      return row;
    });
  }

  create(tenantId: string, input: CreateCaseDto) {
    const data = input.data ?? {};
    // Byte length, not string length: JSON.stringify(...).length counts UTF-16
    // code units, so '₹' and Devanagari names would each be undercounted and a
    // payload several times the intended budget would pass.
    if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_DATA_BYTES) {
      throw new BadRequestException("data is too large");
    }

    return this.db
      .withTenant(tenantId, async (tx) => {
      const wf = await this.resolveWorkflow(tx, input.workflow);

      // The workflow's first stage, by position — not a stage named "Pending".
      // A college's first stage might be "Awaiting documents".
      const [firstStage] = await tx
        .select()
        .from(workflowStages)
        .where(eq(workflowStages.workflowId, wf.id))
        .orderBy(asc(workflowStages.position))
        .limit(1);

      const [contact] = await tx
        .insert(contacts)
        .values({
          tenantId,
          // The caller declares this. It cannot be inferred from `organisation`
          // being set — a person very often has one (a borrower's business, a
          // candidate's employer) — and `name` is required, so there is no
          // "name is absent so it must be a company" signal either.
          kind: input.kind ?? "person",
          name: input.name,
          organisation: input.organisation ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
        })
        .returning();

      // References are random, so a collision is possible but vanishingly rare.
      // The unique index is the authority; we retry rather than trust luck.
      //
      // Each attempt MUST run in its own savepoint. In PostgreSQL a failed
      // statement aborts the entire transaction, so a bare retry would hit
      // 25P02 ("current transaction is aborted") on the next INSERT and every
      // statement after it — the retry would be dead code that also destroys
      // the surrounding work. A nested drizzle transaction emits a real
      // SAVEPOINT / ROLLBACK TO, leaving the outer transaction usable.
      for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
        try {
          return await tx.transaction(async (sp) => {
            const [created] = await sp
              .insert(cases)
              .values({
                tenantId,
                workflowId: wf.id,
                contactId: contact.id,
                stageId: firstStage?.id ?? null,
                reference: generateCaseReference(),
                source: input.source ?? null,
                data,
              })
              .returning();
            return created;
          });
        } catch (err) {
          // 23505 = unique_violation: this reference is taken, draw another.
          // Anything else is a real failure and must surface.
          if (pgErrorCode(err) !== "23505") throw err;
        }
      }
      throw new BadRequestException("Could not allocate a case reference; please retry");
      })
      .then((created) => {
        // The borrower's first document request. Fire-and-forget AFTER the case
        // is committed: a send problem (or no email on file) is recorded on
        // case_messages and must never fail or delay case creation itself.
        void this.nudges
          .sendNudge(tenantId, created.id, "initial")
          .catch((e) => this.log.error(`initial nudge for case ${created.id} failed: ${e}`));
        return created;
      });
  }

  /**
   * Edit a case's details, journaling exactly what changed.
   *
   * Contact fields and case data live in two tables, so both writes and the
   * journal line share ONE transaction: a half-applied edit that still claims
   * in the audit trail to have happened fully is worse than a failed one.
   */
  async update(tenantId: string, userId: string, caseId: string, input: UpdateCaseDto) {
    const authorName = await this.authorName(userId);
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: cases.id, contactId: cases.contactId, data: cases.data })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");

      const changes: { field: string; from: string | null; to: string | null }[] = [];
      const show = (v: unknown) =>
        v === undefined || v === null || v === "" ? null : String(v);

      // ---- the subject's own fields -------------------------------------
      if (row.contactId) {
        const [contact] = await tx
          .select()
          .from(contacts)
          .where(eq(contacts.id, row.contactId))
          .limit(1);
        if (contact) {
          const next: Partial<typeof contact> = {};
          const track = (field: string, current: string | null, incoming: string | null | undefined) => {
            if (incoming === undefined) return; // not sent = not touched
            const to = incoming === null || incoming.trim() === "" ? null : incoming.trim();
            if (to === current) return;
            changes.push({ field, from: show(current), to: show(to) });
            return to;
          };
          const name = track("Name", contact.name, input.name);
          // name is NOT NULL — an explicit blank is refused rather than stored.
          if (name !== undefined) {
            if (name === null) throw new BadRequestException("Name cannot be empty");
            next.name = name;
          }
          const org = track("Organisation", contact.organisation, input.organisation);
          if (org !== undefined) next.organisation = org;
          const email = track("Email", contact.email, input.email);
          if (email !== undefined) next.email = email;
          const phone = track("Phone", contact.phone, input.phone);
          if (phone !== undefined) next.phone = phone;

          if (Object.keys(next).length > 0) {
            await tx.update(contacts).set(next).where(eq(contacts.id, contact.id));
          }
        }
      }

      // ---- the workflow's own data fields --------------------------------
      if (input.data) {
        const current = (row.data ?? {}) as Record<string, unknown>;
        // MERGE, never replace: two people editing different fields on the
        // same case must not erase each other.
        const merged = { ...current, ...input.data };
        // Same ceiling as create, and byte length not string length — see create().
        if (Buffer.byteLength(JSON.stringify(merged), "utf8") > MAX_DATA_BYTES) {
          throw new BadRequestException("data is too large");
        }
        for (const [key, value] of Object.entries(input.data)) {
          if (show(current[key]) === show(value)) continue;
          changes.push({ field: key, from: show(current[key]), to: show(value) });
        }
        await tx.update(cases).set({ data: merged, updatedAt: new Date() }).where(eq(cases.id, caseId));
      }

      // A no-op edit writes no journal line — an audit trail full of "changed
      // nothing" is an audit trail nobody reads.
      if (changes.length > 0) {
        await tx.insert(caseEvents).values({
          tenantId,
          caseId,
          kind: "details_changed",
          authorId: userId,
          authorName,
          data: { changes },
        });
      }

      const [updated] = await tx.select().from(cases).where(eq(cases.id, caseId)).limit(1);
      return updated;
    });
  }

  async updateStage(tenantId: string, userId: string, caseId: string, stageId: string) {
    if (!stageId) throw new BadRequestException("stageId is required");
    const authorName = await this.authorName(userId);
    return this.db.withTenant(tenantId, async (tx) => {
      // Load the case (RLS-scoped to this tenant) to learn its workflow.
      const [row] = await tx
        .select({ id: cases.id, workflowId: cases.workflowId, stageId: cases.stageId })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");

      // The target stage must exist AND belong to this case's workflow.
      // withTenant already scopes workflow_stages to this tenant via RLS, so a
      // stage owned by another tenant is invisible here; the workflowId match
      // additionally blocks cross-workflow stage references within the tenant.
      const [stage] = await tx
        .select({ id: workflowStages.id, name: workflowStages.name })
        .from(workflowStages)
        .where(and(eq(workflowStages.id, stageId), eq(workflowStages.workflowId, row.workflowId)))
        .limit(1);
      if (!stage) throw new BadRequestException("Stage does not belong to this case's workflow");

      const [updated] = await tx
        .update(cases)
        .set({ stageId, updatedAt: new Date() })
        .where(eq(cases.id, caseId))
        .returning();

      // The journal line — written in the SAME transaction as the move, so
      // the two can never disagree. A move to the stage the case is already
      // in changes nothing and writes nothing.
      if (row.stageId !== stageId) {
        const [from] = row.stageId
          ? await tx
              .select({ name: workflowStages.name })
              .from(workflowStages)
              .where(eq(workflowStages.id, row.stageId))
              .limit(1)
          : [undefined];
        await tx.insert(caseEvents).values({
          tenantId,
          caseId,
          kind: "stage_changed",
          authorId: userId,
          authorName,
          data: { from: from?.name ?? null, to: stage.name },
        });
      }
      return updated;
    });
  }

  /** The case's journal, newest first. 404 mirrors get(): a miss is "not here". */
  listEvents(tenantId: string, caseId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");
      return tx
        .select()
        .from(caseEvents)
        .where(eq(caseEvents.caseId, caseId))
        .orderBy(desc(caseEvents.createdAt));
    });
  }

  /**
   * The full back-and-forth with the subject, oldest first, both channels.
   * Inbound rows come from conversation_messages (the words the pollers now
   * keep); outbound document requests come from case_messages — merged at
   * read time so neither is stored twice and the two can never drift.
   */
  listConversation(tenantId: string, caseId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");

      const [inbound, outbound] = await Promise.all([
        tx
          .select()
          .from(conversationMessages)
          .where(eq(conversationMessages.caseId, caseId)),
        tx.select().from(caseMessages).where(eq(caseMessages.caseId, caseId)),
      ]);

      const thread = [
        ...inbound.map((m) => ({
          id: m.id,
          channel: m.channel,
          direction: m.direction,
          counterpart: m.sender,
          subject: m.subject,
          body: m.body,
          kind: null as string | null,
          failed: false,
          at: m.sentAt,
        })),
        ...outbound.map((m) => ({
          id: m.id,
          channel: m.channel,
          direction: "outbound" as const,
          counterpart: m.recipient,
          subject: m.subject,
          // The request's body isn't stored; what it asked for is. Say that.
          body: `Document request — ${(m.itemsSnapshot ?? []).length} item(s) requested`,
          kind: m.kind as string | null,
          failed: m.status === "failed",
          at: m.sentAt,
        })),
      ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

      return thread;
    });
  }

  async addComment(tenantId: string, user: AuthUser, caseId: string, input: AddCommentDto) {
    const body = input.body.trim();
    // The DB CHECK would refuse an all-whitespace comment anyway; refusing it
    // here turns a 500 into an honest 400.
    if (!body) throw new BadRequestException("A note needs some text");
    const authorName = await this.authorName(user.userId);
    return this.db.withTenant(tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: cases.id, workflowId: cases.workflowId })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");

      if (input.requirementId) {
        // The pin must be one of THIS case's checklist items.
        const [req] = await tx
          .select({ id: documentRequirements.id })
          .from(documentRequirements)
          .where(
            and(
              eq(documentRequirements.id, input.requirementId),
              eq(documentRequirements.workflowId, row.workflowId),
            ),
          )
          .limit(1);
        if (!req) throw new BadRequestException("That checklist item does not belong to this case");
      }

      const [created] = await tx
        .insert(caseEvents)
        .values({
          tenantId,
          caseId,
          requirementId: input.requirementId ?? null,
          kind: "comment",
          authorId: user.userId,
          authorName,
          body,
        })
        .returning();
      return created;
    });
  }

  /**
   * The name history keeps. Read via admin — `users` is global, not
   * tenant-scoped, exactly as auth reads it — and denormalised onto the event
   * so the journal survives the account being deleted.
   */
  private async authorName(userId: string): Promise<string> {
    const [u] = await this.db.admin
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return u?.name ?? "Unknown";
  }
}

@Controller("cases")
@UseGuards(JwtAuthGuard)
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query("workflow") workflow?: string) {
    return this.cases.list(u.tenantId, workflow);
  }

  @Get(":id")
  get(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.cases.get(u.tenantId, id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() body: CreateCaseDto) {
    return this.cases.create(u.tenantId, body);
  }

  @Patch(":id")
  update(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateCaseDto,
  ) {
    return this.cases.update(u.tenantId, u.userId, id, body);
  }

  @Patch(":id/stage")
  updateStage(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateStageDto,
  ) {
    return this.cases.updateStage(u.tenantId, u.userId, id, body.stageId);
  }

  @Get(":id/events")
  events(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.cases.listEvents(u.tenantId, id);
  }

  @Get(":id/conversation")
  conversation(@CurrentUser() u: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    return this.cases.listConversation(u.tenantId, id);
  }

  @Post(":id/comments")
  addComment(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AddCommentDto,
  ) {
    return this.cases.addComment(u.tenantId, u, id, body);
  }
}

@Module({
  imports: [NudgesModule],
  controllers: [CasesController],
  providers: [CasesService],
  // Exported for the intake endpoint: a case born from the website must be
  // created by the SAME code path as one born in the dashboard — reference
  // retry, first stage, initial document request and all.
  exports: [CasesService],
})
export class CasesModule {}
