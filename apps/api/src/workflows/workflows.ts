import {
  cases,
  documentRequirements,
  fieldConfigs,
  workflows,
  workflowStages,
  type FieldDef,
  type RequirementCondition,
} from "@docket/db";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  Allow,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import {
  CurrentUser,
  JwtAuthGuard,
  Roles,
  RolesGuard,
  AuthModule,
  type AuthUser,
} from "../auth/auth";
import { DbService } from "../db/db";
import type { Tx } from "@docket/db";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_RE = /^[a-z][a-z0-9_]*$/;

const STAGE_TONES = [
  "muted",
  "teal",
  "primary",
  "amber",
  "orange",
  "green",
  "red",
] as const;

const FIELD_TYPES = ["string", "integer", "enum"] as const;
const INPUT_TYPES = ["text", "number", "dropdown", "textarea"] as const;

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug || !SLUG_RE.test(slug)) {
    throw new BadRequestException(
      "Could not derive a valid slug from the name - supply one explicitly.",
    );
  }
  return slug;
}

function normalizeField(f: FieldDefDto, index: number): FieldDef {
  const field_key = f.field_key.trim();
  if (!KEY_RE.test(field_key)) {
    throw new BadRequestException(
      `Invalid field_key "${f.field_key}" - use snake_case starting with a letter.`,
    );
  }
  if (f.input_type === "dropdown" && (!f.options || f.options.length === 0)) {
    throw new BadRequestException(
      `Dropdown field "${field_key}" needs at least one option.`,
    );
  }
  const def: FieldDef = {
    field_key,
    label: f.label.trim(),
    field_type: f.field_type,
    input_type: f.input_type,
    required: f.required,
    order: f.order ?? index,
  };
  if (f.options?.length) def.options = f.options.map((o) => o.trim()).filter(Boolean);
  if (f.placeholder) def.placeholder = f.placeholder;
  if (f.show_in_table !== undefined) def.show_in_table = f.show_in_table;
  if (f.format) def.format = f.format;
  if (f.validation) def.validation = f.validation;
  return def;
}

function normalizeCondition(
  c: RequirementConditionDto | null | undefined,
): RequirementCondition | null {
  if (!c) return null;
  if (!c.field?.trim()) {
    throw new BadRequestException("Condition needs a field key.");
  }
  if (c.equals === undefined && (!c.in || c.in.length === 0)) {
    throw new BadRequestException(
      "Condition needs equals or in.",
    );
  }
  const out: RequirementCondition = { field: c.field.trim() };
  if (c.equals !== undefined) out.equals = c.equals;
  if (c.in?.length) out.in = c.in;
  return out;
}

/* ------------------------------------------------------------------ */
/* DTOs                                                                */
/* ------------------------------------------------------------------ */

export class CreateWorkflowDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(SLUG_RE)
  @MaxLength(64)
  slug?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  subjectLabel!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  caseLabel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class UpdateWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  subjectLabel?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  caseLabel?: string;

  /** Pass null to clear. Empty string is normalised to null in the service. */
  @IsOptional()
  @Allow()
  description?: string | null;
}

export class StageItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsIn([...STAGE_TONES])
  tone!: string;

  @IsInt()
  @Min(0)
  @Max(999)
  position!: number;
}

export class PutStagesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StageItemDto)
  @ArrayMaxSize(40)
  stages!: StageItemDto[];
}

export class FieldDefDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  field_key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsIn([...FIELD_TYPES])
  field_type!: (typeof FIELD_TYPES)[number];

  @IsIn([...INPUT_TYPES])
  input_type!: (typeof INPUT_TYPES)[number];

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  options?: string[];

  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  placeholder?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  order?: number;

  @IsOptional()
  @IsBoolean()
  show_in_table?: boolean;

  @IsOptional()
  @IsIn(["inr"])
  format?: "inr";
}

export class PutFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldDefDto)
  @ArrayMaxSize(80)
  fields!: FieldDefDto[];
}

export class RequirementConditionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  field!: string;

  @IsOptional()
  @Allow()
  equals?: string | number | boolean;

  @IsOptional()
  @IsArray()
  @Allow()
  in?: (string | number)[];
}

export class RequirementItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @Matches(KEY_RE)
  @MaxLength(64)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @Allow()
  description?: string | null;

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  accepts?: string[];

  @IsInt()
  @Min(1)
  @Max(100)
  maxFiles!: number;

  @IsBoolean()
  reusable!: boolean;

  @IsOptional()
  @Allow()
  validityDays?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @ValidateNested()
  @Type(() => RequirementConditionDto)
  condition?: RequirementConditionDto | null;

  @IsInt()
  @Min(0)
  @Max(999)
  position!: number;
}

export class PutRequirementsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RequirementItemDto)
  @ArrayMaxSize(80)
  requirements!: RequirementItemDto[];
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

@Injectable()
export class WorkflowsService {
  constructor(private readonly db: DbService) {}

  /**
   * The tenant's workflows, with their vocabulary and domain fields.
   *
   * The client needs this to know which workflow it is showing. Without it the
   * dashboard has to assume a slug, and the only slug it could assume was
   * "business-loan" - which is exactly the lending hardcode this platform is
   * being rebuilt to remove. A college tenant has no such workflow.
   *
   * `fields` rides along for the same reason: the Cases table's domain columns
   * come from FieldDef.show_in_table, so the screen renders whatever THIS
   * workflow declares instead of a hardcoded industry's picks. A workflow with
   * no field config gets [] - the screen just shows no domain columns.
   */
  list(tenantId: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({
          id: workflows.id,
          name: workflows.name,
          slug: workflows.slug,
          description: workflows.description,
          subjectLabel: workflows.subjectLabel,
          caseLabel: workflows.caseLabel,
        })
        .from(workflows)
        .orderBy(asc(workflows.name));

      const configs = await tx
        .select({
          workflowId: fieldConfigs.workflowId,
          fields: fieldConfigs.fields,
        })
        .from(fieldConfigs)
        .orderBy(asc(fieldConfigs.createdAt));

      const reqCounts = await tx
        .select({
          workflowId: documentRequirements.workflowId,
          n: count(),
        })
        .from(documentRequirements)
        .groupBy(documentRequirements.workflowId);

      const stageCounts = await tx
        .select({
          workflowId: workflowStages.workflowId,
          n: count(),
        })
        .from(workflowStages)
        .groupBy(workflowStages.workflowId);

      const reqByWf = new Map(reqCounts.map((r) => [r.workflowId, Number(r.n)]));
      const stageByWf = new Map(
        stageCounts.map((r) => [r.workflowId, Number(r.n)]),
      );

      return rows.map((w) => {
        const fields = configs
          .filter((c) => c.workflowId === w.id)
          .flatMap((c) => c.fields ?? [])
          .filter((f): f is FieldDef => !!f && typeof f.field_key === "string");
        return {
          ...w,
          fields,
          stageCount: stageByWf.get(w.id) ?? 0,
          requirementCount: reqByWf.get(w.id) ?? 0,
        };
      });
    });
  }

  async getBySlug(tenantId: string, slug: string) {
    const list = await this.list(tenantId);
    const wf = list.find((w) => w.slug === slug);
    if (!wf) throw new NotFoundException(`Workflow "${slug}" not found`);
    return wf;
  }

  create(tenantId: string, input: CreateWorkflowDto) {
    const slug = input.slug?.trim() || slugify(input.name);
    return this.db.withTenant(tenantId, async (tx) => {
      const [existing] = await tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(eq(workflows.slug, slug))
        .limit(1);
      if (existing) {
        throw new ConflictException(
          `A workflow with slug "${slug}" already exists in this workspace.`,
        );
      }

      const [wf] = await tx
        .insert(workflows)
        .values({
          tenantId,
          name: input.name.trim(),
          slug,
          description: input.description?.trim() || null,
          subjectLabel: input.subjectLabel.trim(),
          caseLabel: input.caseLabel.trim(),
        })
        .returning({
          id: workflows.id,
          name: workflows.name,
          slug: workflows.slug,
          description: workflows.description,
          subjectLabel: workflows.subjectLabel,
          caseLabel: workflows.caseLabel,
        });

      await tx.insert(fieldConfigs).values({
        tenantId,
        workflowId: wf.id,
        name: "Default",
        fields: [],
        visibleRoles: [],
      });

      return { ...wf, fields: [] as FieldDef[], stageCount: 0, requirementCount: 0 };
    });
  }

  update(tenantId: string, slug: string, input: UpdateWorkflowDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      const wf = await this.requireWorkflow(tx, slug);
      const [updated] = await tx
        .update(workflows)
        .set({
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.subjectLabel !== undefined
            ? { subjectLabel: input.subjectLabel.trim() }
            : {}),
          ...(input.caseLabel !== undefined
            ? { caseLabel: input.caseLabel.trim() }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description?.trim() || null }
            : {}),
        })
        .where(eq(workflows.id, wf.id))
        .returning({
          id: workflows.id,
          name: workflows.name,
          slug: workflows.slug,
          description: workflows.description,
          subjectLabel: workflows.subjectLabel,
          caseLabel: workflows.caseLabel,
        });
      return updated;
    });
  }

  delete(tenantId: string, slug: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const wf = await this.requireWorkflow(tx, slug);
      const [row] = await tx
        .select({ n: count() })
        .from(cases)
        .where(eq(cases.workflowId, wf.id));
      const caseCount = Number(row?.n ?? 0);
      if (caseCount > 0) {
        throw new ConflictException(
          `This workflow has ${caseCount} case${caseCount === 1 ? "" : "s"} and cannot be deleted.`,
        );
      }
      await tx.delete(workflows).where(eq(workflows.id, wf.id));
      return { ok: true as const };
    });
  }

  listStages(tenantId: string, workflowSlug: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const wf = await this.requireWorkflow(tx, workflowSlug);
      return tx
        .select({
          id: workflowStages.id,
          name: workflowStages.name,
          tone: workflowStages.tone,
          position: workflowStages.position,
        })
        .from(workflowStages)
        .where(eq(workflowStages.workflowId, wf.id))
        .orderBy(asc(workflowStages.position));
    });
  }

  putStages(tenantId: string, workflowSlug: string, input: PutStagesDto) {
    return this.db.withTenant(tenantId, async (tx) => {
      const wf = await this.requireWorkflow(tx, workflowSlug);
      const existing = await tx
        .select({
          id: workflowStages.id,
          name: workflowStages.name,
          tone: workflowStages.tone,
          position: workflowStages.position,
        })
        .from(workflowStages)
        .where(eq(workflowStages.workflowId, wf.id));

      const existingIds = new Set(existing.map((s) => s.id));
      const keepIds = new Set(
        input.stages.filter((s) => s.id && existingIds.has(s.id)).map((s) => s.id!),
      );
      const toDelete = existing.filter((s) => !keepIds.has(s.id));

      if (toDelete.length > 0) {
        const blocked = await tx
          .select({
            stageId: cases.stageId,
            n: count(),
          })
          .from(cases)
          .where(
            and(
              inArray(
                cases.stageId,
                toDelete.map((s) => s.id),
              ),
              isNull(cases.deletedAt),
            ),
          )
          .groupBy(cases.stageId);
        if (blocked.length > 0) {
          const names = blocked
            .map((b) => {
              const st = toDelete.find((s) => s.id === b.stageId);
              return st?.name ?? "unknown";
            })
            .join(", ");
          throw new ConflictException(
            `Cannot remove stage(s) with open cases: ${names}. Move those cases first.`,
          );
        }
        await tx
          .delete(workflowStages)
          .where(
            inArray(
              workflowStages.id,
              toDelete.map((s) => s.id),
            ),
          );
      }

      for (const s of input.stages) {
        if (s.id && existingIds.has(s.id)) {
          await tx
            .update(workflowStages)
            .set({
              name: s.name.trim(),
              tone: s.tone,
              position: s.position,
            })
            .where(eq(workflowStages.id, s.id));
        } else {
          await tx.insert(workflowStages).values({
            tenantId,
            workflowId: wf.id,
            name: s.name.trim(),
            tone: s.tone,
            position: s.position,
          });
        }
      }

      return tx
        .select({
          id: workflowStages.id,
          name: workflowStages.name,
          tone: workflowStages.tone,
          position: workflowStages.position,
        })
        .from(workflowStages)
        .where(eq(workflowStages.workflowId, wf.id))
        .orderBy(asc(workflowStages.position));
    });
  }

  listFields(tenantId: string, workflowSlug: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const wf = await this.requireWorkflow(tx, workflowSlug);
      return this.fieldsForWorkflow(tx, wf.id);
    });
  }

  putFields(tenantId: string, workflowSlug: string, input: PutFieldsDto) {
    const fields = input.fields.map((f, i) => normalizeField(f, i));
    const keys = fields.map((f) => f.field_key);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException("Duplicate field_key in the field list.");
    }

    return this.db.withTenant(tenantId, async (tx) => {
      const wf = await this.requireWorkflow(tx, workflowSlug);
      const [config] = await tx
        .select({ id: fieldConfigs.id })
        .from(fieldConfigs)
        .where(eq(fieldConfigs.workflowId, wf.id))
        .orderBy(asc(fieldConfigs.createdAt))
        .limit(1);

      if (config) {
        await tx
          .update(fieldConfigs)
          .set({ fields })
          .where(eq(fieldConfigs.id, config.id));
      } else {
        await tx.insert(fieldConfigs).values({
          tenantId,
          workflowId: wf.id,
          name: "Default",
          fields,
          visibleRoles: [],
        });
      }
      return fields;
    });
  }

  listRequirements(tenantId: string, workflowSlug: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const wf = await this.requireWorkflow(tx, workflowSlug);
      return tx
        .select({
          id: documentRequirements.id,
          key: documentRequirements.key,
          label: documentRequirements.label,
          description: documentRequirements.description,
          required: documentRequirements.required,
          accepts: documentRequirements.accepts,
          maxFiles: documentRequirements.maxFiles,
          reusable: documentRequirements.reusable,
          validityDays: documentRequirements.validityDays,
          condition: documentRequirements.condition,
          position: documentRequirements.position,
        })
        .from(documentRequirements)
        .where(eq(documentRequirements.workflowId, wf.id))
        .orderBy(asc(documentRequirements.position));
    });
  }

  putRequirements(
    tenantId: string,
    workflowSlug: string,
    input: PutRequirementsDto,
  ) {
    const keys = input.requirements.map((r) => r.key);
    if (new Set(keys).size !== keys.length) {
      throw new BadRequestException("Duplicate requirement key in the list.");
    }

    return this.db.withTenant(tenantId, async (tx) => {
      const wf = await this.requireWorkflow(tx, workflowSlug);
      const existing = await tx
        .select({ id: documentRequirements.id, key: documentRequirements.key })
        .from(documentRequirements)
        .where(eq(documentRequirements.workflowId, wf.id));

      const existingIds = new Set(existing.map((r) => r.id));
      const keepIds = new Set(
        input.requirements
          .filter((r) => r.id && existingIds.has(r.id))
          .map((r) => r.id!),
      );
      const toDelete = existing.filter((r) => !keepIds.has(r.id));
      if (toDelete.length > 0) {
        await tx
          .delete(documentRequirements)
          .where(
            inArray(
              documentRequirements.id,
              toDelete.map((r) => r.id),
            ),
          );
      }

      for (const r of input.requirements) {
        const condition = normalizeCondition(r.condition);
        const values = {
          label: r.label.trim(),
          description: r.description?.trim() || null,
          required: r.required,
          accepts: r.accepts ?? [],
          maxFiles: r.maxFiles,
          reusable: r.reusable,
          validityDays: r.validityDays ?? null,
          condition,
          position: r.position,
        };

        if (r.id && existingIds.has(r.id)) {
          // Keys are sticky after create - never rewrite classifier matching key.
          await tx
            .update(documentRequirements)
            .set(values)
            .where(eq(documentRequirements.id, r.id));
        } else {
          await tx.insert(documentRequirements).values({
            tenantId,
            workflowId: wf.id,
            key: r.key,
            ...values,
          });
        }
      }

      return tx
        .select({
          id: documentRequirements.id,
          key: documentRequirements.key,
          label: documentRequirements.label,
          description: documentRequirements.description,
          required: documentRequirements.required,
          accepts: documentRequirements.accepts,
          maxFiles: documentRequirements.maxFiles,
          reusable: documentRequirements.reusable,
          validityDays: documentRequirements.validityDays,
          condition: documentRequirements.condition,
          position: documentRequirements.position,
        })
        .from(documentRequirements)
        .where(eq(documentRequirements.workflowId, wf.id))
        .orderBy(asc(documentRequirements.position));
    });
  }

  private async requireWorkflow(tx: Tx, slug: string) {
    const [wf] = await tx
      .select({ id: workflows.id, slug: workflows.slug })
      .from(workflows)
      .where(eq(workflows.slug, slug))
      .limit(1);
    if (!wf) throw new NotFoundException(`Workflow "${slug}" not found`);
    return wf;
  }

  private async fieldsForWorkflow(tx: Tx, workflowId: string): Promise<FieldDef[]> {
    const configs = await tx
      .select({ fields: fieldConfigs.fields })
      .from(fieldConfigs)
      .where(eq(fieldConfigs.workflowId, workflowId))
      .orderBy(asc(fieldConfigs.createdAt));
    return configs
      .flatMap((c) => c.fields ?? [])
      .filter((f): f is FieldDef => !!f && typeof f.field_key === "string");
  }
}

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */

@Controller("workflows")
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.workflows.list(u.tenantId);
  }

  @Post()
  @Roles("owner", "admin")
  create(@CurrentUser() u: AuthUser, @Body() body: CreateWorkflowDto) {
    return this.workflows.create(u.tenantId, body);
  }

  // Literal subpaths before `:slug` so they are never swallowed as a slug.
  @Get(":slug/stages")
  listStages(@CurrentUser() u: AuthUser, @Param("slug") slug: string) {
    return this.workflows.listStages(u.tenantId, slug);
  }

  @Put(":slug/stages")
  @Roles("owner", "admin")
  putStages(
    @CurrentUser() u: AuthUser,
    @Param("slug") slug: string,
    @Body() body: PutStagesDto,
  ) {
    return this.workflows.putStages(u.tenantId, slug, body);
  }

  @Get(":slug/fields")
  listFields(@CurrentUser() u: AuthUser, @Param("slug") slug: string) {
    return this.workflows.listFields(u.tenantId, slug);
  }

  @Put(":slug/fields")
  @Roles("owner", "admin")
  putFields(
    @CurrentUser() u: AuthUser,
    @Param("slug") slug: string,
    @Body() body: PutFieldsDto,
  ) {
    return this.workflows.putFields(u.tenantId, slug, body);
  }

  @Get(":slug/requirements")
  listRequirements(@CurrentUser() u: AuthUser, @Param("slug") slug: string) {
    return this.workflows.listRequirements(u.tenantId, slug);
  }

  @Put(":slug/requirements")
  @Roles("owner", "admin")
  putRequirements(
    @CurrentUser() u: AuthUser,
    @Param("slug") slug: string,
    @Body() body: PutRequirementsDto,
  ) {
    return this.workflows.putRequirements(u.tenantId, slug, body);
  }

  @Get(":slug")
  get(@CurrentUser() u: AuthUser, @Param("slug") slug: string) {
    return this.workflows.getBySlug(u.tenantId, slug);
  }

  @Patch(":slug")
  @Roles("owner", "admin")
  update(
    @CurrentUser() u: AuthUser,
    @Param("slug") slug: string,
    @Body() body: UpdateWorkflowDto,
  ) {
    return this.workflows.update(u.tenantId, slug, body);
  }

  @Delete(":slug")
  @Roles("owner", "admin")
  delete(@CurrentUser() u: AuthUser, @Param("slug") slug: string) {
    return this.workflows.delete(u.tenantId, slug);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
})
export class WorkflowsModule {}
