// Production tenant provisioning.
//
// Deliberately separate from seed.ts, which is a dev fixture: the seed hardcodes
// a demo tenant, falls back to a default password, prints that password to
// stdout, and would duplicate rows if run twice. None of that is acceptable for
// production, where stdout ends up in SSM command output and CloudTrail.
//
// This takes every value from the environment, refuses to run without an
// explicit password, logs nothing sensitive, and is safe to re-run.
//
// Runs as the migration/owner role, which bypasses RLS — correct here, since
// provisioning creates the tenant that RLS would otherwise scope us to.
import { and, eq } from "drizzle-orm";
import { createDb } from "./client";
import * as schema from "./schema";
import { hashPassword } from "./password";
import { LEAD_FIELDS, STAGES } from "./business-loan-config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — refusing to bootstrap.`);
  return value;
}

async function main() {
  const url = required("DATABASE_URL");
  // No fallback: a production password must be passed in deliberately.
  const adminPassword = required("ADMIN_PASSWORD");
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@finlot.ai";
  const adminName = process.env.ADMIN_NAME ?? "Admin";
  const tenantName = process.env.TENANT_NAME ?? "Finlot";
  const tenantSlug = process.env.TENANT_SLUG ?? "finlot";
  const tenantPlan = process.env.TENANT_PLAN ?? "internal";
  const workflowSlug = "business-loan";

  // Hash before opening the transaction — argon2 is deliberately slow and there
  // is no reason to hold the transaction open while it runs.
  const passwordHash = await hashPassword(adminPassword);

  const db = createDb(url);
  const report = await db.transaction(async (tx) => {
    /* ---- tenant ---- */
    const [insertedTenant] = await tx
      .insert(schema.tenants)
      .values({ name: tenantName, slug: tenantSlug, plan: tenantPlan })
      .onConflictDoNothing({ target: schema.tenants.slug })
      .returning();
    const tenant =
      insertedTenant ??
      (
        await tx
          .select()
          .from(schema.tenants)
          .where(eq(schema.tenants.slug, tenantSlug))
          .limit(1)
      )[0];

    /* ---- admin user ---- */
    const [insertedUser] = await tx
      .insert(schema.users)
      .values({ email: adminEmail, name: adminName, passwordHash })
      .onConflictDoNothing({ target: schema.users.email })
      .returning();
    const user =
      insertedUser ??
      (
        await tx
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, adminEmail))
          .limit(1)
      )[0];

    // An existing user keeps its password — re-running must never silently
    // reset someone's credentials. The one exception is a row that has no
    // password yet (invited-but-not-activated), which is what we came to set.
    let passwordSet = Boolean(insertedUser);
    if (!insertedUser && user.passwordHash === null) {
      await tx
        .update(schema.users)
        .set({ passwordHash })
        .where(eq(schema.users.id, user.id));
      passwordSet = true;
    }

    /* ---- membership ---- */
    await tx
      .insert(schema.memberships)
      .values({ userId: user.id, tenantId: tenant.id, role: "owner" })
      .onConflictDoNothing({
        target: [schema.memberships.userId, schema.memberships.tenantId],
      });

    /* ---- workflow ---- */
    const [insertedWorkflow] = await tx
      .insert(schema.workflows)
      .values({ tenantId: tenant.id, name: "Business Loan", slug: workflowSlug })
      .onConflictDoNothing({
        target: [schema.workflows.tenantId, schema.workflows.slug],
      })
      .returning();
    // Must filter on tenant too: the unique constraint is (tenant_id, slug), and
    // this runs as the owner role, so RLS is not here to scope it for us the way
    // it scopes the same lookup inside withTenant().
    const workflow =
      insertedWorkflow ??
      (
        await tx
          .select()
          .from(schema.workflows)
          .where(
            and(
              eq(schema.workflows.tenantId, tenant.id),
              eq(schema.workflows.slug, workflowSlug),
            ),
          )
          .limit(1)
      )[0];

    /* ---- stages & lead config ----
     * workflow_stages and lead_configs have no unique constraint, so there is
     * no conflict target to lean on — a blind re-insert would silently
     * duplicate all 12 stages. Guard on what is already there instead. */
    const existingStages = await tx
      .select({ id: schema.workflowStages.id })
      .from(schema.workflowStages)
      .where(eq(schema.workflowStages.workflowId, workflow.id))
      .limit(1);
    let stagesInserted = 0;
    if (existingStages.length === 0) {
      await tx.insert(schema.workflowStages).values(
        STAGES.map((s, i) => ({
          tenantId: tenant.id,
          workflowId: workflow.id,
          name: s.name,
          position: i,
          tone: s.tone,
        })),
      );
      stagesInserted = STAGES.length;
    }

    const existingConfigs = await tx
      .select({ id: schema.leadConfigs.id })
      .from(schema.leadConfigs)
      .where(eq(schema.leadConfigs.workflowId, workflow.id))
      .limit(1);
    let configInserted = false;
    if (existingConfigs.length === 0) {
      await tx.insert(schema.leadConfigs).values({
        tenantId: tenant.id,
        workflowId: workflow.id,
        name: "Business Loan Lead",
        fields: LEAD_FIELDS,
        visibleRoles: [],
      });
      configInserted = true;
    }

    return {
      tenant: insertedTenant ? "created" : "existed",
      user: insertedUser ? "created" : "existed",
      passwordSet,
      workflow: insertedWorkflow ? "created" : "existed",
      stagesInserted,
      configInserted,
    };
  });

  // Nothing here is sensitive: no password, no hash.
  console.log(`Tenant "${tenantSlug}" ${report.tenant}, plan "${tenantPlan}".`);
  console.log(
    `Admin ${adminEmail} ${report.user}; password ${report.passwordSet ? "set" : "left unchanged"}.`,
  );
  console.log(
    `Workflow "${workflowSlug}" ${report.workflow}; ${report.stagesInserted} stages inserted; lead config ${report.configInserted ? "inserted" : "already present"}.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
