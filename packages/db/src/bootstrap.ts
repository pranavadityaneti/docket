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
// Runs as the migration/owner role, which bypasses RLS - correct here, since
// provisioning creates the tenant that RLS would otherwise scope us to.
import { and, eq } from "drizzle-orm";
import {
  DOCUMENT_REQUIREMENTS,
  LEAD_FIELDS,
  STAGES,
  WORKFLOW,
} from "./business-loan-config";
import { createDb } from "./client";
import { hashPassword } from "./password";
import * as schema from "./schema";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set - refusing to bootstrap.`);
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
  const workflowSlug = WORKFLOW.slug;

  // Hash before opening the transaction - argon2 is deliberately slow and there
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

    // An existing user keeps its password - re-running must never silently
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
    // Whether this workflow already existed has to be decided BEFORE the
    // upsert. onConflictDoUpdate always returns a row, so "did .returning()
    // give us anything" no longer tells a create apart from an update - it
    // reported every re-run as a fresh install.
    //
    // Filtered on tenant as well as slug: the unique constraint is
    // (tenant_id, slug), and this runs as the owner role, so RLS is not here to
    // scope the lookup the way it does inside withTenant().
    const [priorWorkflow] = await tx
      .select({ id: schema.workflows.id })
      .from(schema.workflows)
      .where(
        and(
          eq(schema.workflows.tenantId, tenant.id),
          eq(schema.workflows.slug, workflowSlug),
        ),
      )
      .limit(1);

    const [workflow] = await tx
      .insert(schema.workflows)
      .values({
        tenantId: tenant.id,
        name: WORKFLOW.name,
        slug: workflowSlug,
        subjectLabel: WORKFLOW.subjectLabel,
        caseLabel: WORKFLOW.caseLabel,
      })
      // Reconcile rather than skip. onConflictDoNothing meant a workflow that
      // already existed could never receive a value it did not have when it was
      // created - which is exactly how every pre-0005 workflow kept the neutral
      // 'Contact'/'Case' defaults after a vocabulary had been declared in
      // config, and why re-running bootstrap could not repair it. This tool's
      // contract is "make the workspace match the declared configuration", so
      // the config-owned columns are written on every run.
      //
      // These three fields only: tenant_id and slug are the conflict target and
      // must not move, and nothing here touches a workspace's own data.
      //
      // When tenants can edit their own vocabulary in the product, this will
      // need a policy for whose value wins; today config is its only author.
      .onConflictDoUpdate({
        target: [schema.workflows.tenantId, schema.workflows.slug],
        set: {
          name: WORKFLOW.name,
          subjectLabel: WORKFLOW.subjectLabel,
          caseLabel: WORKFLOW.caseLabel,
        },
      })
      .returning();

    /* ---- stages & field config ----
     * workflow_stages and field_configs have no unique constraint, so there is
     * no conflict target to lean on - a blind re-insert would silently
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
      .select({ id: schema.fieldConfigs.id })
      .from(schema.fieldConfigs)
      .where(eq(schema.fieldConfigs.workflowId, workflow.id))
      .limit(1);
    let configInserted = false;
    if (existingConfigs.length === 0) {
      await tx.insert(schema.fieldConfigs).values({
        tenantId: tenant.id,
        workflowId: workflow.id,
        name: WORKFLOW.name,
        fields: LEAD_FIELDS,
        visibleRoles: [],
      });
      configInserted = true;
    }

    // document_requirements has a unique (workflow_id, key), so unlike stages
    // this CAN lean on a conflict target: re-running adds any checklist item
    // the blueprint has gained without duplicating or overwriting the rest.
    let requirementsInserted = 0;
    if (DOCUMENT_REQUIREMENTS.length) {
      const inserted = await tx
        .insert(schema.documentRequirements)
        .values(
          DOCUMENT_REQUIREMENTS.map((r) => ({
            ...r,
            tenantId: tenant.id,
            workflowId: workflow.id,
          })),
        )
        .onConflictDoNothing({
          target: [schema.documentRequirements.workflowId, schema.documentRequirements.key],
        })
        .returning({ id: schema.documentRequirements.id });
      requirementsInserted = inserted.length;
    }

    return {
      tenant: insertedTenant ? "created" : "existed",
      user: insertedUser ? "created" : "existed",
      passwordSet,
      workflow: priorWorkflow ? "existed" : "created",
      stagesInserted,
      configInserted,
      requirementsInserted,
    };
  });

  // Nothing here is sensitive: no password, no hash.
  console.log(`Tenant "${tenantSlug}" ${report.tenant}, plan "${tenantPlan}".`);
  console.log(
    `Admin ${adminEmail} ${report.user}; password ${report.passwordSet ? "set" : "left unchanged"}.`,
  );
  console.log(
    `Workflow "${workflowSlug}" ${report.workflow}; ${report.stagesInserted} stages inserted; field config ${report.configInserted ? "inserted" : "already present"}; ${report.requirementsInserted} document requirements inserted.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
