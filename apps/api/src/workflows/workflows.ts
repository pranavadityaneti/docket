import { Controller, Get, Injectable, Module, NotFoundException, Param, UseGuards } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { workflows, workflowStages } from "@docket/db";
import { DbService } from "../db/db";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";

@Injectable()
export class WorkflowsService {
  constructor(private readonly db: DbService) {}

  /**
   * The tenant's workflows, with their vocabulary.
   *
   * The client needs this to know which workflow it is showing. Without it the
   * dashboard has to assume a slug, and the only slug it could assume was
   * "business-loan" — which is exactly the lending hardcode this platform is
   * being rebuilt to remove. A college tenant has no such workflow.
   */
  list(tenantId: string) {
    return this.db.withTenant(tenantId, (tx) =>
      tx
        .select({
          id: workflows.id,
          name: workflows.name,
          slug: workflows.slug,
          subjectLabel: workflows.subjectLabel,
          caseLabel: workflows.caseLabel,
        })
        .from(workflows)
        .orderBy(asc(workflows.name)),
    );
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
  constructor(private readonly workflows: WorkflowsService) {}

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
export class WorkflowsModule {}
