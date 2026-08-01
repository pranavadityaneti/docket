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
  cases,
  contacts,
  generateCaseReference,
  SUBJECT_KINDS,
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

export class UpdateStageDto {
  @IsUUID()
  stageId!: string;
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

  updateStage(tenantId: string, caseId: string, stageId: string) {
    if (!stageId) throw new BadRequestException("stageId is required");
    return this.db.withTenant(tenantId, async (tx) => {
      // Load the case (RLS-scoped to this tenant) to learn its workflow.
      const [row] = await tx
        .select({ id: cases.id, workflowId: cases.workflowId })
        .from(cases)
        .where(eq(cases.id, caseId))
        .limit(1);
      if (!row) throw new NotFoundException("Case not found");

      // The target stage must exist AND belong to this case's workflow.
      // withTenant already scopes workflow_stages to this tenant via RLS, so a
      // stage owned by another tenant is invisible here; the workflowId match
      // additionally blocks cross-workflow stage references within the tenant.
      const [stage] = await tx
        .select({ id: workflowStages.id })
        .from(workflowStages)
        .where(and(eq(workflowStages.id, stageId), eq(workflowStages.workflowId, row.workflowId)))
        .limit(1);
      if (!stage) throw new BadRequestException("Stage does not belong to this case's workflow");

      const [updated] = await tx
        .update(cases)
        .set({ stageId, updatedAt: new Date() })
        .where(eq(cases.id, caseId))
        .returning();
      return updated;
    });
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

  @Patch(":id/stage")
  updateStage(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateStageDto,
  ) {
    return this.cases.updateStage(u.tenantId, id, body.stageId);
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
