import { createDb } from "./client";
import * as schema from "./schema";
import type { LeadFieldDef } from "./schema";

/* The Business-Loan workflow's 12 stages (mirrors the live Gain tenant). */
const STAGES: { name: string; tone: string }[] = [
  { name: "Pending", tone: "muted" },
  { name: "Proprietorship Documents Collection", tone: "teal" },
  { name: "Partnership Document Collection", tone: "teal" },
  { name: "PVT LTD Document Collection", tone: "teal" },
  { name: "Follow up", tone: "amber" },
  { name: "Auto Follow-Up", tone: "amber" },
  { name: "Human Escalated", tone: "orange" },
  { name: "Not Interested", tone: "muted" },
  { name: "Not Picked", tone: "muted" },
  { name: "No Answer", tone: "muted" },
  { name: "Completed", tone: "green" },
  { name: "Missing PanCard", tone: "red" },
];

/* The 8-field Business-Loan lead config ("Portal" corrects Gain's "Protal" typo). */
const LEAD_FIELDS: LeadFieldDef[] = [
  { field_key: "pan_number", label: "PAN Number", field_type: "string", input_type: "text", required: false, validation: { regex: "^[A-Z]{5}[0-9]{4}[A-Z]{1}$", minimum: "10", maximum: "10" }, placeholder: "Enter PAN number", order: 0 },
  { field_key: "company_name", label: "Company Name", field_type: "string", input_type: "text", required: false, validation: { minimum: "1", maximum: "100" }, placeholder: "Enter company name", order: 1 },
  { field_key: "loan_amount", label: "Loan Amount (₹)", field_type: "integer", input_type: "number", required: false, validation: { minimum: "1" }, placeholder: "Enter loan amount", order: 2 },
  { field_key: "loan_type", label: "Loan Type", field_type: "enum", input_type: "dropdown", required: false, options: ["SME Term Loan", "LAP", "Working Capital", "Top-up"], order: 3 },
  { field_key: "entity_type", label: "Entity Type", field_type: "enum", input_type: "dropdown", required: false, options: ["Proprietorship", "Partnership", "Private Limited", "Public Limited", "LLP"], order: 4 },
  { field_key: "source", label: "Source", field_type: "enum", input_type: "dropdown", required: false, options: ["Portal", "Whatsapp", "Email", "Referral", "Website", "Other"], order: 5 },
  { field_key: "monthly_turnover", label: "Monthly Turnover", field_type: "integer", input_type: "number", required: false, order: 6 },
  { field_key: "funds_needed", label: "Funds Needed", field_type: "string", input_type: "textarea", required: false, order: 7 },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const db = createDb(url);

  const [tenant] = await db
    .insert(schema.tenants)
    .values({ name: "Finlot (Demo)", slug: "finlot", plan: "trial" })
    .returning();

  const [user] = await db
    .insert(schema.users)
    .values({ email: "admin@finlot.ai", name: "Demo Admin" })
    .returning();

  await db.insert(schema.memberships).values({
    userId: user.id,
    tenantId: tenant.id,
    role: "owner",
  });

  const [workflow] = await db
    .insert(schema.workflows)
    .values({ tenantId: tenant.id, name: "Business Loan", slug: "business-loan" })
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

  await db.insert(schema.leadConfigs).values({
    tenantId: tenant.id,
    workflowId: workflow.id,
    name: "Business Loan Lead",
    fields: LEAD_FIELDS,
    visibleRoles: [],
  });

  console.log(`Seeded tenant "${tenant.slug}" with the Business Loan workflow (${STAGES.length} stages, ${LEAD_FIELDS.length} fields).`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
