import { Controller, Get, Injectable, Module, NotFoundException, Param, UseGuards } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { workflows, workflowStages } from "@docket/db";
import { DbService } from "../db/db";
import { CurrentUser, JwtAuthGuard, type AuthUser } from "../auth/auth";

@Injectable()
export class WorkflowsService {
  constructor(private readonly db: DbService) {}

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

  @Get(":slug/stages")
  listStages(@CurrentUser() u: AuthUser, @Param("slug") slug: string) {
    return this.workflows.listStages(u.tenantId, slug);
  }
}

@Module({ controllers: [WorkflowsController], providers: [WorkflowsService] })
export class WorkflowsModule {}
