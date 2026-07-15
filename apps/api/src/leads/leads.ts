import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
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
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { and, desc, eq } from "drizzle-orm";
import { contacts, leads, workflows, workflowStages } from "@docket/db";
import { DbService } from "../db/db";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";

// bigint upper bound for money fields (₹): generous enough for any real loan,
// low enough to reject overflow/garbage. ~₹1 lakh crore.
const MAX_AMOUNT = 1_000_000_000_000;

export class CreateLeadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  company?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  pan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  loanType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  entityType?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  amount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT)
  monthlyTurnover?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fundsNeeded?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  workflow?: string;
}

export class UpdateStageDto {
  @IsUUID()
  stageId!: string;
}

@Injectable()
export class LeadsService {
  constructor(private readonly db: DbService) {}

  list(tenantId: string, workflowSlug: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [wf] = await tx.select().from(workflows).where(eq(workflows.slug, workflowSlug)).limit(1);
      if (!wf) return [];
      return tx
        .select({
          id: leads.id,
          amount: leads.amount,
          loanType: leads.loanType,
          entityType: leads.entityType,
          source: leads.source,
          monthlyTurnover: leads.monthlyTurnover,
          data: leads.data,
          createdAt: leads.createdAt,
          updatedAt: leads.updatedAt,
          contactName: contacts.name,
          contactCompany: contacts.company,
          stageId: workflowStages.id,
          stageName: workflowStages.name,
          stageTone: workflowStages.tone,
        })
        .from(leads)
        .leftJoin(contacts, eq(leads.contactId, contacts.id))
        .leftJoin(workflowStages, eq(leads.stageId, workflowStages.id))
        .where(eq(leads.workflowId, wf.id))
        .orderBy(desc(leads.createdAt));
    });
  }

  create(tenantId: string, input: CreateLeadDto) {
    const workflowSlug = input.workflow ?? "business-loan";
    return this.db.withTenant(tenantId, async (tx) => {
      const [wf] = await tx.select().from(workflows).where(eq(workflows.slug, workflowSlug)).limit(1);
      if (!wf) throw new NotFoundException(`Workflow "${workflowSlug}" not found`);
      const [pending] = await tx
        .select()
        .from(workflowStages)
        .where(and(eq(workflowStages.workflowId, wf.id), eq(workflowStages.name, "Pending")))
        .limit(1);

      const [contact] = await tx
        .insert(contacts)
        .values({ tenantId, name: input.name, company: input.company ?? null })
        .returning();

      const [lead] = await tx
        .insert(leads)
        .values({
          tenantId,
          workflowId: wf.id,
          contactId: contact.id,
          stageId: pending?.id ?? null,
          amount: input.amount ?? null,
          loanType: input.loanType ?? null,
          entityType: input.entityType ?? null,
          source: input.source ?? null,
          monthlyTurnover: input.monthlyTurnover ?? null,
          data: { pan_number: input.pan ?? null, funds_needed: input.fundsNeeded ?? null },
        })
        .returning();

      return lead;
    });
  }

  updateStage(tenantId: string, leadId: string, stageId: string) {
    if (!stageId) throw new BadRequestException("stageId is required");
    return this.db.withTenant(tenantId, async (tx) => {
      // Load the lead (RLS-scoped to this tenant) to learn its workflow.
      const [lead] = await tx
        .select({ id: leads.id, workflowId: leads.workflowId })
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1);
      if (!lead) throw new NotFoundException("Lead not found");

      // The target stage must exist AND belong to this lead's workflow.
      // withTenant already scopes workflow_stages to this tenant via RLS, so a
      // stage owned by another tenant is invisible here; the workflowId match
      // additionally blocks cross-workflow stage references within the tenant.
      const [stage] = await tx
        .select({ id: workflowStages.id })
        .from(workflowStages)
        .where(
          and(eq(workflowStages.id, stageId), eq(workflowStages.workflowId, lead.workflowId)),
        )
        .limit(1);
      if (!stage) throw new BadRequestException("Stage does not belong to this lead's workflow");

      const [updated] = await tx
        .update(leads)
        .set({ stageId, updatedAt: new Date() })
        .where(eq(leads.id, leadId))
        .returning();
      return updated;
    });
  }
}

@Controller("leads")
@UseGuards(JwtAuthGuard)
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query("workflow") workflow = "business-loan") {
    return this.leads.list(u.tenantId, workflow);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() body: CreateLeadDto) {
    return this.leads.create(u.tenantId, body);
  }

  @Patch(":id/stage")
  updateStage(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateStageDto,
  ) {
    return this.leads.updateStage(u.tenantId, id, body.stageId);
  }
}

@Module({ controllers: [LeadsController], providers: [LeadsService] })
export class LeadsModule {}
