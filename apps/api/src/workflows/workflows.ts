import { fieldConfigs, workflows, workflowStages, type FieldDef } from "@docket/db";
import { Controller, Get, Injectable, Module, NotFoundException, Param, UseGuards } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";
import { DbService } from "../db/db";

@Injectable()
export class WorkflowsService {
  constructor(private readonly db: DbService) { }

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
          subjectLabel: workflows.subjectLabel,
          caseLabel: workflows.caseLabel,
        })
        .from(workflows)
        .orderBy(asc(workflows.name));

      // One query for every config rather than one per workflow. A workflow can
      // have several configs (they are role-scoped); fields are concatenated in
      // creation order, first declaration of a field_key wins downstream.
      const configs = await tx
        .select({ workflowId: fieldConfigs.workflowId, fields: fieldConfigs.fields })
        .from(fieldConfigs)
        .orderBy(asc(fieldConfigs.createdAt));

      return rows.map((w) => ({
        ...w,
        fields: configs
          .filter((c) => c.workflowId === w.id)
          .flatMap((c) => c.fields ?? [])
          .filter((f): f is FieldDef => !!f && typeof f.field_key === "string"),
      }));
    });
  }

  listStages(tenantId: string, workflowSlug: string) {
    return this.db.withTenant(tenantId, async (tx) => {
      const [wf] = await tx
        .select()
        .from(workflows)
        .where(eq(workflows.slug, workflowSlug))
        .limit(1);
      if (!wf) throw new NotFoundException(`Workflow "${workflowSlug}" not found`);
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
}

@Controller("workflows")
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) { }

  // Declared before ":slug/stages" so the literal path is matched first and a
  // workflow can never be created with the slug that shadows this route.
  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.workflows.list(u.tenantId);
  }

  @Get(":slug/stages")
  listStages(@CurrentUser() u: AuthUser, @Param("slug") slug: string) {
    return this.workflows.listStages(u.tenantId, slug);
  }
}

@Module({ controllers: [WorkflowsController], providers: [WorkflowsService] })
export class WorkflowsModule { }
