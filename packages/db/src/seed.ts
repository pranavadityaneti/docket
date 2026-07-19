import { createDb } from "./client";
import * as schema from "./schema";
import { hashPassword } from "./password";
import {
  DOCUMENT_REQUIREMENTS,
  LEAD_FIELDS,
  STAGES,
  WORKFLOW,
} from "./business-loan-config";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url);

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: "Finlot (Demo)", slug: "finlot", plan: "trial" })
    .returning();

  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "DocketAdmin!2026";
  const [user] = await db
    .insert(schema.users)
    .values({
      email: "admin@finlot.ai",
      name: "Demo Admin",
      passwordHash: await hashPassword(adminPassword),
    })
    .returning();

  await db.insert(schema.memberships).values({
    userId: user.id,
    tenantId: tenant.id,
    role: "owner",
  });

  const [workflow] = await db
    .insert(schema.workflows)
    .values({
      tenantId: tenant.id,
      name: WORKFLOW.name,
      slug: WORKFLOW.slug,
      subjectLabel: WORKFLOW.subjectLabel,
      caseLabel: WORKFLOW.caseLabel,
    })
    .returning();

  await db.insert(schema.workflowStages).values(
    STAGES.map((s, i) => ({
      tenantId: tenant.id,
      workflowId: workflow.id,
      name: s.name,
      position: i,
      tone: s.tone,
    })),
  );

  await db.insert(schema.fieldConfigs).values({
    tenantId: tenant.id,
    workflowId: workflow.id,
    name: WORKFLOW.name,
    fields: LEAD_FIELDS,
    visibleRoles: [],
  });

  await db.insert(schema.documentRequirements).values(
    DOCUMENT_REQUIREMENTS.map((r) => ({ ...r, tenantId: tenant.id, workflowId: workflow.id })),
  );

  console.log(`Seeded tenant "${tenant.slug}" with the Business Loan workflow (${STAGES.length} stages, ${LEAD_FIELDS.length} fields, ${DOCUMENT_REQUIREMENTS.length} document requirements).`);
  console.log(`Admin login: admin@finlot.ai / ${adminPassword}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
