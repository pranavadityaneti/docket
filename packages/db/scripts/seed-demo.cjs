/**
 * Demo provisioning: the College Admissions workflow + a handful of fictional
 * cases across both workflows, so the dashboard demonstrates the multi-industry
 * story with real (but clearly fake) data.
 *
 * Written as a self-contained .cjs so it runs unchanged on the EB instance
 * against the deployed @docket/db package (dist + node_modules), delivered via
 * SSM - and identically against a local database. Uses SQL through `postgres`
 * rather than drizzle so it has no compile step.
 *
 * SAFETY RAILS (the reasons this script exists instead of ad-hoc inserts):
 *  - Idempotent. The workflow is keyed by slug, stages/requirements are only
 *    inserted when the workflow is first created, and each demo case is keyed
 *    by its contact's email - re-running changes nothing.
 *  - Every seeded case is born with nudges_paused_at set. Without this the
 *    hourly reminder cron would start emailing the fictional example.com
 *    addresses within the hour.
 *  - No document rows. Fabricated documents with no real bytes would break
 *    open/download in a live demo; documents arrive live instead.
 *
 * Usage: DATABASE_URL=... node scripts/seed-demo.cjs   (from packages/db)
 */
const path = require("node:path");
// Resolve dist relative to this file so it works from any cwd, deployed or local.
const { sslFor, generateCaseReference } = require(
  path.join(__dirname, "..", "dist", "index.js"),
);
// Plain resolution on purpose: locally this finds packages/db/node_modules,
// and on the deployed instance it walks up into the pnpm virtual store -
// an explicit path would only be right in one of the two layouts.
const postgres = require("postgres");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set - refusing to run.");
  process.exit(1);
}

const ADMISSIONS = {
  name: "College Admissions",
  slug: "college-admissions",
  subjectLabel: "Student",
  caseLabel: "Admission",
  stages: [
    { name: "New enquiry", tone: "muted" },
    { name: "Documents pending", tone: "teal" },
    { name: "Under review", tone: "amber" },
    { name: "Offer made", tone: "orange" },
    { name: "Enrolled", tone: "green" },
  ],
  requirements: [
    { key: "marksheet_10", label: "10th marksheet", required: true },
    { key: "marksheet_12", label: "12th marksheet", required: true },
    {
      key: "transfer_certificate",
      label: "Transfer certificate",
      required: true,
    },
    {
      key: "id_proof",
      label: "ID proof (Aadhaar or passport)",
      required: true,
    },
    { key: "passport_photo", label: "Passport photograph", required: true },
    // Scores go stale: an old attempt cannot support this year's admission.
    {
      key: "entrance_score",
      label: "Entrance exam score card",
      required: true,
      validityDays: 365,
    },
    {
      key: "migration_certificate",
      label: "Migration certificate",
      required: false,
    },
  ],
  fields: [
    {
      field_key: "course_applied",
      label: "Course applied",
      field_type: "string",
      input_type: "text",
      required: true,
      order: 0,
      show_in_table: true,
    },
    {
      field_key: "entrance_exam",
      label: "Entrance exam",
      field_type: "string",
      input_type: "text",
      required: false,
      order: 1,
      show_in_table: true,
    },
    {
      field_key: "previous_school",
      label: "Previous school / college",
      field_type: "string",
      input_type: "text",
      required: false,
      order: 2,
    },
  ],
};

/** Fictional demo cases. example.com emails can never reach a real person. */
const DEMO_CASES = [
  // Business Loan
  {
    workflow: "business-loan",
    stage: "Follow up",
    name: "Meera Nair",
    organisation: "Nair Textiles",
    email: "meera.nair@example.com",
    phone: "+91 98450 11223",
    data: {
      loan_type: "SME Term Loan",
      loan_amount: 1800000,
      entity_type: "Proprietorship",
      company_name: "Nair Textiles",
    },
  },
  {
    workflow: "business-loan",
    stage: "PVT LTD Document Collection",
    name: "Arjun Mehta",
    organisation: "Mehta Agro Exports Pvt Ltd",
    email: "arjun.mehta@example.com",
    phone: "+91 98220 44556",
    data: {
      loan_type: "LAP",
      loan_amount: 5500000,
      entity_type: "Private Limited",
      company_name: "Mehta Agro Exports Pvt Ltd",
    },
  },
  {
    workflow: "business-loan",
    stage: "Pending",
    name: "Sunita Reddy",
    organisation: "Reddy Hardware",
    email: "sunita.reddy@example.com",
    phone: "+91 99630 77889",
    data: {
      loan_type: "SME Term Loan",
      loan_amount: 900000,
      entity_type: "Partnership",
      company_name: "Reddy Hardware",
    },
  },
  // College Admissions
  {
    workflow: "college-admissions",
    stage: "Documents pending",
    name: "Ananya Sharma",
    organisation: null,
    email: "ananya.sharma@example.com",
    phone: "+91 90040 12321",
    data: {
      course_applied: "B.Sc Computer Science",
      entrance_exam: "CUET",
      previous_school: "DAV Public School",
    },
  },
  {
    workflow: "college-admissions",
    stage: "New enquiry",
    name: "Rohan Verma",
    organisation: null,
    email: "rohan.verma@example.com",
    phone: "+91 98110 45654",
    data: { course_applied: "BBA", previous_school: "St. Xavier's" },
  },
  {
    workflow: "college-admissions",
    stage: "Under review",
    name: "Fatima Khan",
    organisation: null,
    email: "fatima.khan@example.com",
    phone: "+91 99870 78987",
    data: {
      course_applied: "M.Com",
      entrance_exam: "University entrance",
      previous_school: "Loyola College",
    },
  },
];

const sql = postgres(url, { max: 1, ssl: sslFor(url), onnotice: () => {} });

(async () => {
  const out = await sql.begin(async (tx) => {
    // With one tenant it is unambiguous; with several, TENANT_SLUG must name
    // the target explicitly - this script never guesses which tenant to touch.
    const slugFilter = process.env.TENANT_SLUG?.trim();
    const tenants = slugFilter
      ? await tx`select id, name from tenants where slug = ${slugFilter}`
      : await tx`select id, name from tenants order by created_at limit 2`;
    if (tenants.length !== 1) {
      throw new Error(
        `Expected exactly 1 tenant${slugFilter ? ` with slug "${slugFilter}"` : ""}, ` +
          `found ${tenants.length} - set TENANT_SLUG to disambiguate.`,
      );
    }
    const tenantId = tenants[0].id;
    const summary = {
      tenant: tenants[0].name,
      workflowCreated: false,
      casesCreated: 0,
      casesSkipped: 0,
    };

    /* ---- Part A: the admissions workflow (skip wholesale if it exists) ---- */
    const existing = await tx`
      select id from workflows where tenant_id = ${tenantId} and slug = ${ADMISSIONS.slug}`;
    let wfId;
    if (existing.length) {
      wfId = existing[0].id;
    } else {
      const [wf] = await tx`
        insert into workflows (tenant_id, name, slug, subject_label, case_label)
        values (${tenantId}, ${ADMISSIONS.name}, ${ADMISSIONS.slug},
                ${ADMISSIONS.subjectLabel}, ${ADMISSIONS.caseLabel})
        returning id`;
      wfId = wf.id;
      summary.workflowCreated = true;
      for (let i = 0; i < ADMISSIONS.stages.length; i++) {
        const s = ADMISSIONS.stages[i];
        await tx`
          insert into workflow_stages (tenant_id, workflow_id, name, position, tone)
          values (${tenantId}, ${wfId}, ${s.name}, ${i}, ${s.tone})`;
      }
      for (let i = 0; i < ADMISSIONS.requirements.length; i++) {
        const r = ADMISSIONS.requirements[i];
        await tx`
          insert into document_requirements
            (tenant_id, workflow_id, key, label, required, validity_days, position)
          values (${tenantId}, ${wfId}, ${r.key}, ${r.label}, ${r.required},
                  ${r.validityDays ?? null}, ${i})`;
      }
      await tx`
        insert into field_configs (tenant_id, workflow_id, name, fields)
        values (${tenantId}, ${wfId}, ${"Admission details"}, ${tx.json(ADMISSIONS.fields)})`;
    }

    /* ---- Part B: demo cases, keyed by contact email ---- */
    for (const spec of DEMO_CASES) {
      const seen = await tx`
        select 1 from contacts where tenant_id = ${tenantId} and email = ${spec.email} limit 1`;
      if (seen.length) {
        summary.casesSkipped++;
        continue;
      }
      const [wf] = await tx`
        select id from workflows where tenant_id = ${tenantId} and slug = ${spec.workflow}`;
      if (!wf) throw new Error(`Workflow ${spec.workflow} not found`);
      const stage = await tx`
        select id from workflow_stages
        where workflow_id = ${wf.id} and name = ${spec.stage} limit 1`;
      const [contact] = await tx`
        insert into contacts (tenant_id, kind, name, organisation, email, phone)
        values (${tenantId}, 'person', ${spec.name}, ${spec.organisation}, ${spec.email}, ${spec.phone})
        returning id`;

      // References are random; the unique index is the authority. Retry a few
      // times inside savepoints, mirroring CasesService.create.
      let created = false;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        try {
          await tx.savepoint(async (sp) => {
            await sp`
              insert into cases
                (tenant_id, workflow_id, contact_id, stage_id, reference, source, data, nudges_paused_at)
              values (${tenantId}, ${wf.id}, ${contact.id}, ${stage[0]?.id ?? null},
                      ${generateCaseReference()}, ${"Demo"}, ${tx.json(spec.data)}, now())`;
          });
          created = true;
        } catch (e) {
          if (e.code !== "23505") throw e;
        }
      }
      if (!created)
        throw new Error(`Could not allocate a reference for ${spec.email}`);
      summary.casesCreated++;
    }
    return summary;
  });

  console.log(
    `tenant="${out.tenant}" workflowCreated=${out.workflowCreated} ` +
      `casesCreated=${out.casesCreated} casesSkipped=${out.casesSkipped}`,
  );
  // Belt and braces: prove every demo case is paused (the cron must never
  // email example.com). Any unpaused Demo case is a bug in this script.
  const unpaused = await sql`
    select count(*)::int as n from cases where source = 'Demo' and nudges_paused_at is null`;
  console.log(`unpaused demo cases: ${unpaused[0].n} (must be 0)`);
  await sql.end();
  process.exit(unpaused[0].n === 0 ? 0 : 1);
})().catch(async (e) => {
  console.error("SEED_ERR", e.message);
  try {
    await sql.end();
  } catch {}
  process.exit(1);
});
