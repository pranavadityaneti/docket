/**
 * Rich local demo data: 2–5 rows across contacts, cases, documents, channels,
 * messages, events, conversations, and unmatched docs. Idempotent - re-run
 * skips anything keyed by example.com emails / demo addresses.
 *
 * Usage: pnpm --filter @docket/db seed:dummy
 * (loads repo-root `.env` for DATABASE_URL / STORAGE_LOCAL_ROOT when unset)
 */
import { and, eq, isNull, like, or } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LEAD_FIELDS,
  DOCUMENT_REQUIREMENTS as LOAN_REQS,
  STAGES as LOAN_STAGES,
  WORKFLOW as LOAN_WF,
} from "./business-loan-config";
import { createDb } from "./client";
import { loadRootEnv } from "./load-env";
import {
  ADMISSION_FIELDS,
  DOCUMENT_REQUIREMENTS as ADMISSION_REQS,
  STAGES as ADMISSION_STAGES,
  WORKFLOW as ADMISSION_WF,
} from "./college-admissions-config";
import {
  DOCUMENT_REQUIREMENTS as COMPANY_REQS,
  STAGES as COMPANY_STAGES,
  WORKFLOW as COMPANY_WF,
  REGISTRATION_FIELDS,
} from "./company-registration-config";
import { hashPassword } from "./password";
import { generatePublicId } from "./public-id";
import { generateCaseReference } from "./reference";
import * as schema from "./schema";

loadRootEnv();

type Db = ReturnType<typeof createDb>;

const TENANT_SLUG = process.env.TENANT_SLUG?.trim() || "finlot";
const AGENT_PASSWORD = process.env.SEED_AGENT_PASSWORD ?? "DocketAgent!2026";
const STORAGE_ROOT =
  process.env.STORAGE_LOCAL_ROOT?.trim() || "/tmp/docket-storage";

function checksum(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function checksumBuf(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Minimal valid PDF the preview iframe can open. */
function dummyPdf(label: string): Buffer {
  const escaped = label.replace(/[()\\]/g, " ");
  const content = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${content.length} >>stream\n${content}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += obj;
  }
  const xrefAt = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "utf8");
}

/** 1×1 PNG (green pixel) - enough for image preview. */
const DUMMY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function putLocalObject(
  key: string,
  body: Buffer,
): Promise<{ sizeBytes: number; checksum: string }> {
  const abs = path.join(STORAGE_ROOT, key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, body);
  return { sizeBytes: body.length, checksum: checksumBuf(body) };
}

/**
 * Ensure a conversation message has previewable attachments on disk + in DB.
 * Idempotent via source_external_id + fileName.
 */
async function ensureAttachment(
  db: Db,
  opts: {
    tenantId: string;
    caseId: string;
    externalId: string;
    channel: "email" | "whatsapp";
    sender: string;
    fileName: string;
    mimeType: string;
    bytes: Buffer;
    requirementId?: string | null;
  },
) {
  const existing = await db
    .select({ id: schema.documents.id, storageKey: schema.documents.storageKey })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.caseId, opts.caseId),
        eq(schema.documents.sourceExternalId, opts.externalId),
        eq(schema.documents.fileName, opts.fileName),
        isNull(schema.documents.deletedAt),
      ),
    )
    .limit(1);

  let docId = existing[0]?.id;
  if (!docId) {
    docId = randomUUID();
    const key = `tenants/${opts.tenantId}/cases/${opts.caseId}/${docId}`;
    const stored = await putLocalObject(key, opts.bytes);
    await db.insert(schema.documents).values({
      id: docId,
      tenantId: opts.tenantId,
      caseId: opts.caseId,
      requirementId: opts.requirementId ?? null,
      fileName: opts.fileName,
      mimeType: opts.mimeType,
      sizeBytes: stored.sizeBytes,
      checksum: stored.checksum,
      storageKey: key,
      status: "received",
      sourceChannel: opts.channel,
      sourceIdentifier: opts.sender,
      sourceExternalId: opts.externalId,
      classifiedType: opts.fileName.endsWith(".png") ? "Photograph" : "PDF",
      classificationConfidence: "high",
      classifiedAt: new Date(),
      autoFiled: false,
    });
    return { created: true as const };
  }

  if (!existing[0]?.storageKey) {
    const key = `tenants/${opts.tenantId}/cases/${opts.caseId}/${docId}`;
    const stored = await putLocalObject(key, opts.bytes);
    await db
      .update(schema.documents)
      .set({
        storageKey: key,
        sizeBytes: stored.sizeBytes,
        checksum: stored.checksum,
        sourceExternalId: opts.externalId,
      })
      .where(eq(schema.documents.id, docId));
  } else {
    // Make sure the bytes still exist for preview after /tmp clears.
    await putLocalObject(existing[0].storageKey, opts.bytes);
  }
  return { created: false as const };
}

/** Backfill previewable attachments onto every demo inbound conversation. */
async function seedConversationAttachments(db: Db, tenantId: string) {
  const msgs = await db
    .select()
    .from(schema.conversationMessages)
    .where(
      and(
        eq(schema.conversationMessages.tenantId, tenantId),
        eq(schema.conversationMessages.direction, "inbound"),
        or(
          like(schema.conversationMessages.externalId, "wa-demo-%"),
          like(schema.conversationMessages.externalId, "email-demo-%"),
        ),
      ),
    );

  let created = 0;
  for (const m of msgs) {
    if (!m.externalId) continue;
    const ref = m.externalId.replace(/^(wa|email)-demo-/, "").replace(/-\d+$/, "");

    if (m.channel === "whatsapp") {
      const r = await ensureAttachment(db, {
        tenantId,
        caseId: m.caseId,
        externalId: m.externalId,
        channel: "whatsapp",
        sender: m.sender,
        fileName: `photo-${ref}.png`,
        mimeType: "image/png",
        bytes: DUMMY_PNG,
      });
      if (r.created) created++;
      const r2 = await ensureAttachment(db, {
        tenantId,
        caseId: m.caseId,
        externalId: m.externalId,
        channel: "whatsapp",
        sender: m.sender,
        fileName: `pan-card-${ref}.pdf`,
        mimeType: "application/pdf",
        bytes: dummyPdf(`PAN Card - ${ref}`),
      });
      if (r2.created) created++;
    } else {
      const r = await ensureAttachment(db, {
        tenantId,
        caseId: m.caseId,
        externalId: m.externalId,
        channel: "email",
        sender: m.sender,
        fileName: `address-proof-${ref}.pdf`,
        mimeType: "application/pdf",
        bytes: dummyPdf(`Address proof - ${ref}`),
      });
      if (r.created) created++;
      const r2 = await ensureAttachment(db, {
        tenantId,
        caseId: m.caseId,
        externalId: m.externalId,
        channel: "email",
        sender: m.sender,
        fileName: `scan-${ref}.png`,
        mimeType: "image/png",
        bytes: DUMMY_PNG,
      });
      if (r2.created) created++;
    }
  }
  return created;
}

async function ensureWorkflow(
  db: Db,
  tenantId: string,
  def: {
    name: string;
    slug: string;
    subjectLabel: string;
    caseLabel: string;
    stages: { name: string; tone: string }[];
    fields: schema.FieldDef[];
    fieldConfigName: string;
    requirements: Omit<schema.NewDocumentRequirement, "tenantId" | "workflowId">[];
  },
) {
  const existing = await db
    .select()
    .from(schema.workflows)
    .where(
      and(
        eq(schema.workflows.tenantId, tenantId),
        eq(schema.workflows.slug, def.slug),
      ),
    )
    .limit(1);
  if (existing[0]) return existing[0];

  const [wf] = await db
    .insert(schema.workflows)
    .values({
      tenantId,
      name: def.name,
      slug: def.slug,
      subjectLabel: def.subjectLabel,
      caseLabel: def.caseLabel,
    })
    .returning();

  await db.insert(schema.workflowStages).values(
    def.stages.map((s, i) => ({
      tenantId,
      workflowId: wf.id,
      name: s.name,
      position: i,
      tone: s.tone,
    })),
  );

  await db.insert(schema.fieldConfigs).values({
    tenantId,
    workflowId: wf.id,
    name: def.fieldConfigName,
    fields: def.fields,
    visibleRoles: [],
  });

  await db.insert(schema.documentRequirements).values(
    def.requirements.map((r) => ({
      ...r,
      tenantId,
      workflowId: wf.id,
    })),
  );

  return wf;
}

async function ensureUser(
  db: Db,
  tenantId: string,
  email: string,
  name: string,
  role: schema.Role,
  password: string,
) {
  const found = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  let user = found[0];
  if (!user) {
    [user] = await db
      .insert(schema.users)
      .values({
        loginId: generatePublicId("user"),
        email,
        name,
        passwordHash: await hashPassword(password),
      })
      .returning();
  }
  const mem = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, user.id),
        eq(schema.memberships.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!mem[0]) {
    await db.insert(schema.memberships).values({
      userId: user.id,
      tenantId,
      role,
    });
  }
  return user;
}

async function ensureChannel(
  db: Db,
  tenantId: string,
  kind: schema.ChannelKind,
  address: string,
  config: schema.ChannelConfig,
) {
  const found = await db
    .select()
    .from(schema.channels)
    .where(
      and(
        eq(schema.channels.tenantId, tenantId),
        eq(schema.channels.kind, kind),
        eq(schema.channels.address, address),
      ),
    )
    .limit(1);
  if (found[0]) return found[0];
  const [row] = await db
    .insert(schema.channels)
    .values({
      tenantId,
      kind,
      address,
      enabled: true,
      config,
      // No secret - channels feature refuses real credential use without a key.
      secretCiphertext: null,
    })
    .returning();
  return row;
}

async function insertCaseWithReference(
  db: Db,
  values: Omit<typeof schema.cases.$inferInsert, "reference">,
) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const [row] = await db
        .insert(schema.cases)
        .values({ ...values, reference: generateCaseReference() })
        .returning();
      return row;
    } catch (err) {
      const e = err as { code?: string };
      if (e.code !== "23505") throw err;
    }
  }
  throw new Error("Could not allocate a unique case reference");
}

type CaseSpec = {
  workflowSlug: string;
  stageName: string;
  name: string;
  organisation: string | null;
  email: string;
  phone: string;
  data: Record<string, unknown>;
  source: string;
};

const LOAN_CASES: CaseSpec[] = [
  {
    workflowSlug: "business-loan",
    stageName: "Follow up",
    name: "Meera Nair",
    organisation: "Nair Textiles",
    email: "meera.nair@example.com",
    phone: "+91 98450 11223",
    source: "WhatsApp",
    data: {
      loan_type: "SME Term Loan",
      loan_amount: 1800000,
      entity_type: "Proprietorship",
      company_name: "Nair Textiles",
      pan_number: "ABCDE1234F",
      monthly_turnover: 450000,
    },
  },
  {
    workflowSlug: "business-loan",
    stageName: "PVT LTD Document Collection",
    name: "Arjun Mehta",
    organisation: "Mehta Agro Exports Pvt Ltd",
    email: "arjun.mehta@example.com",
    phone: "+91 98220 44556",
    source: "Website",
    data: {
      loan_type: "LAP",
      loan_amount: 5500000,
      entity_type: "Private Limited",
      company_name: "Mehta Agro Exports Pvt Ltd",
      pan_number: "AABCM1234G",
    },
  },
  {
    workflowSlug: "business-loan",
    stageName: "Pending",
    name: "Sunita Reddy",
    organisation: "Reddy Hardware",
    email: "sunita.reddy@example.com",
    phone: "+91 99630 77889",
    source: "Referral",
    data: {
      loan_type: "SME Term Loan",
      loan_amount: 900000,
      entity_type: "Partnership",
      company_name: "Reddy Hardware",
    },
  },
  {
    workflowSlug: "business-loan",
    stageName: "Human Escalated",
    name: "Vikram Joshi",
    organisation: "Joshi Spices LLP",
    email: "vikram.joshi@example.com",
    phone: "+91 98765 33445",
    source: "Email",
    data: {
      loan_type: "Working Capital",
      loan_amount: 3200000,
      entity_type: "LLP",
      company_name: "Joshi Spices LLP",
      funds_needed: "Inventory for festival season",
    },
  },
  {
    workflowSlug: "business-loan",
    stageName: "Completed",
    name: "Priya Desai",
    organisation: "Desai Dental Clinic",
    email: "priya.desai@example.com",
    phone: "+91 99001 55667",
    source: "Portal",
    data: {
      loan_type: "Top-up",
      loan_amount: 750000,
      entity_type: "Proprietorship",
      company_name: "Desai Dental Clinic",
    },
  },
];

const ADMISSION_CASES: CaseSpec[] = [
  {
    workflowSlug: "college-admissions",
    stageName: "Documents pending",
    name: "Ananya Sharma",
    organisation: null,
    email: "ananya.sharma@example.com",
    phone: "+91 90040 12321",
    source: "Website",
    data: {
      course_applied: "B.Sc Computer Science",
      course_level: "Undergraduate",
      admission_route: "Entrance exam",
      entrance_exam: "CUET",
      category: "General",
      previous_school: "DAV Public School",
    },
  },
  {
    workflowSlug: "college-admissions",
    stageName: "New enquiry",
    name: "Rohan Verma",
    organisation: null,
    email: "rohan.verma@example.com",
    phone: "+91 98110 45654",
    source: "WhatsApp",
    data: {
      course_applied: "BBA",
      course_level: "Undergraduate",
      previous_school: "St. Xavier's",
      category: "OBC",
    },
  },
  {
    workflowSlug: "college-admissions",
    stageName: "Under review",
    name: "Fatima Khan",
    organisation: null,
    email: "fatima.khan@example.com",
    phone: "+91 99870 78987",
    source: "Email",
    data: {
      course_applied: "M.Com",
      course_level: "Postgraduate",
      entrance_exam: "University entrance",
      previous_school: "Loyola College",
      category: "General",
    },
  },
  {
    workflowSlug: "college-admissions",
    stageName: "Offer made",
    name: "Kabir Singh",
    organisation: null,
    email: "kabir.singh@example.com",
    phone: "+91 91234 88776",
    source: "Referral",
    data: {
      course_applied: "B.Tech CSE",
      course_level: "Undergraduate",
      admission_route: "Counselling allotment",
      category: "EWS",
      seat_type: "State quota",
    },
  },
];

const COMPANY_CASES: CaseSpec[] = [
  {
    workflowSlug: "company-registration",
    stageName: "Documents pending",
    name: "Neha Kapoor",
    organisation: "Kapoor Retail Pvt Ltd (proposed)",
    email: "neha.kapoor@example.com",
    phone: "+91 97654 22110",
    source: "Website",
    data: {
      entity_type: "Private Limited",
      proposed_name: "Kapoor Retail Private Limited",
      office_premises: "Rented",
      foreign_promoter: "No",
    },
  },
  {
    workflowSlug: "company-registration",
    stageName: "Name approval",
    name: "Imran Ali",
    organisation: "Ali Foods LLP (proposed)",
    email: "imran.ali@example.com",
    phone: "+91 93456 77880",
    source: "Email",
    data: {
      entity_type: "LLP",
      proposed_name: "Ali Foods LLP",
      office_premises: "Owned",
      foreign_promoter: "No",
    },
  },
  {
    workflowSlug: "company-registration",
    stageName: "New request",
    name: "Sneha Iyer",
    organisation: "Iyer Consulting",
    email: "sneha.iyer@example.com",
    phone: "+91 90123 44556",
    source: "Referral",
    data: {
      entity_type: "Sole Proprietorship",
      proposed_name: "Iyer Consulting",
      office_premises: "Rented",
      foreign_promoter: "No",
    },
  },
];

async function seedCaseBundle(
  db: Db,
  opts: {
    tenantId: string;
    ownerId: string;
    authorName: string;
    spec: CaseSpec;
    stages: { id: string; name: string }[];
    requirements: { id: string; key: string; label: string }[];
    workflowId: string;
  },
) {
  const { tenantId, ownerId, authorName, spec, stages, requirements, workflowId } =
    opts;

  const existingContact = await db
    .select()
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.tenantId, tenantId),
        eq(schema.contacts.email, spec.email),
      ),
    )
    .limit(1);
  if (existingContact[0]) {
    return { created: false as const };
  }

  const [contact] = await db
    .insert(schema.contacts)
    .values({
      tenantId,
      kind: "person",
      name: spec.name,
      organisation: spec.organisation,
      email: spec.email,
      phone: spec.phone,
    })
    .returning();

  const stage = stages.find((s) => s.name === spec.stageName);
  const caseRow = await insertCaseWithReference(db, {
    tenantId,
    workflowId,
    contactId: contact.id,
    stageId: stage?.id ?? null,
    ownerId,
    source: "Demo",
    data: { ...spec.data, _demo_channel_source: spec.source },
    nudgesPausedAt: new Date(),
  });

  const reqSlice = requirements.slice(0, Math.min(4, requirements.length));
  const docStatuses: schema.DocumentStatus[] = [
    "accepted",
    "needs_review",
    "received",
    "rejected",
  ];
  const docChannels: schema.DocumentChannel[] = [
    "whatsapp",
    "email",
    "upload",
    "import",
  ];

  const insertedDocs: { id: string }[] = [];
  for (let i = 0; i < reqSlice.length; i++) {
    const req = reqSlice[i];
    const status = docStatuses[i % docStatuses.length];
    const [doc] = await db
      .insert(schema.documents)
      .values({
        tenantId,
        caseId: caseRow.id,
        requirementId: status === "received" && i === 2 ? null : req.id,
        fileName: `${req.key}-${spec.email.split("@")[0]}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 120_000 + i * 17_000,
        checksum: checksum(`${spec.email}:${req.key}`),
        storageKey: null,
        status,
        rejectionReason:
          status === "rejected" ? "Blurry scan - please reshoot both sides" : null,
        sourceChannel: docChannels[i % docChannels.length],
        sourceIdentifier: i % 2 === 0 ? spec.phone : spec.email,
        classifiedType: req.label,
        classificationConfidence: i === 1 ? "medium" : "high",
        classifiedAt: new Date(),
        autoFiled: status === "accepted",
        reviewedBy: status === "accepted" || status === "rejected" ? ownerId : null,
        reviewedAt:
          status === "accepted" || status === "rejected" ? new Date() : null,
        suggestedRequirementId: status === "needs_review" ? req.id : null,
      })
      .returning({ id: schema.documents.id });
    insertedDocs.push(doc);
  }

  const snapshot = reqSlice.slice(0, 3).map((r, i) => ({
    key: r.key,
    label: r.label,
    state: (i === 0 ? "rejected" : "missing") as "missing" | "rejected",
    reason: i === 0 ? "Blurry scan" : undefined,
  }));

  await db.insert(schema.caseMessages).values([
    {
      tenantId,
      caseId: caseRow.id,
      kind: "initial",
      channel: "email",
      recipient: spec.email,
      subject: `Documents needed - ${caseRow.reference}`,
      itemsSnapshot: snapshot,
      status: "sent",
    },
    {
      tenantId,
      caseId: caseRow.id,
      kind: "reminder",
      channel: "whatsapp",
      recipient: spec.phone,
      subject: null,
      itemsSnapshot: snapshot.slice(0, 2),
      status: "sent",
    },
  ]);

  await db.insert(schema.caseEvents).values([
    {
      tenantId,
      caseId: caseRow.id,
      kind: "comment",
      authorId: ownerId,
      authorName,
      body: `Demo note: reached ${spec.name} on ${spec.source}. Waiting on remaining docs.`,
      data: {},
    },
    {
      tenantId,
      caseId: caseRow.id,
      kind: "stage_changed",
      authorId: ownerId,
      authorName,
      body: null,
      data: {
        from: stages[0]?.name ?? null,
        to: spec.stageName,
      },
    },
    {
      tenantId,
      caseId: caseRow.id,
      kind: "document_reviewed",
      authorId: ownerId,
      authorName,
      requirementId: reqSlice[0]?.id ?? null,
      body: null,
      data: {
        verdict: "accepted",
        documentId: insertedDocs[0]?.id ?? null,
      },
    },
  ]);

  await db.insert(schema.conversationMessages).values([
    {
      tenantId,
      caseId: caseRow.id,
      channel: "whatsapp",
      direction: "inbound",
      sender: spec.phone,
      subject: null,
      body: `Hi, sending docs for ${caseRow.reference}`,
      externalId: `wa-demo-${caseRow.reference}-1`,
    },
    {
      tenantId,
      caseId: caseRow.id,
      channel: "email",
      direction: "inbound",
      sender: spec.email,
      subject: `Re: Documents for ${caseRow.reference}`,
      body: "Attached PAN and address proof. Will send bank statements tomorrow.",
      externalId: `email-demo-${caseRow.reference}-1`,
    },
    {
      tenantId,
      caseId: caseRow.id,
      channel: "whatsapp",
      direction: "outbound",
      sender: "+91 80000 00001",
      subject: null,
      body: "Thanks - we received your files. Please also share last 12 months bank statements.",
      externalId: `wa-demo-${caseRow.reference}-out-1`,
    },
  ]);

  return { created: true as const, caseId: caseRow.id, reference: caseRow.reference };
}

async function seedNotifications(db: Db, tenantId: string) {
  const existing = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(eq(schema.notifications.tenantId, tenantId))
    .limit(1);
  if (existing[0]) return 0;

  const cases = await db
    .select({
      id: schema.cases.id,
      reference: schema.cases.reference,
      contactName: schema.contacts.name,
    })
    .from(schema.cases)
    .innerJoin(schema.contacts, eq(schema.cases.contactId, schema.contacts.id))
    .where(
      and(eq(schema.cases.tenantId, tenantId), isNull(schema.cases.deletedAt)),
    )
    .limit(8);

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
  const c0 = cases[0];
  const c1 = cases[1];
  const c2 = cases[2];

  const rows: schema.NewNotification[] = [
    c0
      ? {
          tenantId,
          kind: "document_received" as const,
          title: `New document on ${c0.reference}`,
          body: `${c0.contactName} uploaded a file for review.`,
          href: `/cases/${c0.id}?tab=checklist`,
          caseId: c0.id,
          createdAt: hoursAgo(1),
        }
      : null,
    c0
      ? {
          tenantId,
          kind: "document_needs_review" as const,
          title: "Document needs review",
          body: `Classification confidence is medium on ${c0.reference}.`,
          href: `/cases/${c0.id}?tab=checklist`,
          caseId: c0.id,
          createdAt: hoursAgo(3),
        }
      : null,
    c1
      ? {
          tenantId,
          kind: "follow_up_due" as const,
          title: "Follow-up due",
          body: `${c1.contactName} still owes outstanding documents.`,
          href: `/cases/${c1.id}?tab=checklist`,
          caseId: c1.id,
          createdAt: hoursAgo(6),
        }
      : null,
    c2
      ? {
          tenantId,
          kind: "stage_changed" as const,
          title: `${c2.reference} moved stages`,
          body: "Stage update recorded on the case.",
          href: `/cases/${c2.id}?tab=activity`,
          caseId: c2.id,
          readAt: hoursAgo(20),
          createdAt: hoursAgo(24),
        }
      : null,
    {
      tenantId,
      kind: "unmatched" as const,
      title: "Unmatched file waiting",
      body: "statement-unknown.pdf could not be matched to a case.",
      href: "/unmatched",
      createdAt: hoursAgo(8),
    },
    c1
      ? {
          tenantId,
          kind: "comment" as const,
          title: "Note added",
          body: `Demo note on ${c1.reference}.`,
          href: `/cases/${c1.id}?tab=activity`,
          caseId: c1.id,
          readAt: hoursAgo(30),
          createdAt: hoursAgo(36),
        }
      : null,
    {
      tenantId,
      kind: "generic" as const,
      title: "Workspace digest",
      body: "Dummy seed loaded a full demo inbox — poke around.",
      href: "/notifications",
      createdAt: hoursAgo(48),
      readAt: hoursAgo(47),
    },
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return 0;
  await db.insert(schema.notifications).values(rows);
  return rows.length;
}

async function seedUnmatched(db: Db, tenantId: string) {
  const samples = [
    {
      channel: "email" as const,
      sender: "mystery.sender@example.com",
      context: "Fwd: statements",
      fileName: "statement-unknown.pdf",
    },
    {
      channel: "whatsapp" as const,
      sender: "+91 90000 11111",
      context: "pan card photo",
      fileName: "IMG_4402.jpg",
    },
    {
      channel: "email" as const,
      sender: "vendor.ops@example.com",
      context: "Invoice - please file",
      fileName: "invoice-7781.pdf",
    },
  ];

  let created = 0;
  for (const s of samples) {
    const existing = await db
      .select()
      .from(schema.unmatchedDocuments)
      .where(
        and(
          eq(schema.unmatchedDocuments.tenantId, tenantId),
          eq(schema.unmatchedDocuments.fileName, s.fileName),
          eq(schema.unmatchedDocuments.status, "pending"),
        ),
      )
      .limit(1);
    if (existing[0]) continue;

    await db.insert(schema.unmatchedDocuments).values({
      tenantId,
      channel: s.channel,
      sender: s.sender,
      context: s.context,
      fileName: s.fileName,
      mimeType: s.fileName.endsWith(".jpg") ? "image/jpeg" : "application/pdf",
      sizeBytes: 88_000,
      checksum: checksum(`unmatched:${s.fileName}`),
      // Placeholder object key - open/download may 404; row itself demos the queue.
      storageKey: `demo/unmatched/${s.fileName}`,
      status: "pending",
    });
    created++;
  }
  return created;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — add it to the repo-root .env (see .env.example)",
    );
  }
  const db = createDb(url);

  const tenants = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, TENANT_SLUG))
    .limit(1);
  const tenant = tenants[0];
  if (!tenant) {
    throw new Error(
      `Tenant slug "${TENANT_SLUG}" not found - run pnpm --filter @docket/db seed first.`,
    );
  }

  const owner = await ensureUser(
    db,
    tenant.id,
    "admin@finlot.ai",
    "Demo Admin",
    "owner",
    process.env.SEED_ADMIN_PASSWORD ?? "DocketAdmin!2026",
  );
  const agent = await ensureUser(
    db,
    tenant.id,
    "agent@finlot.ai",
    "Demo Agent",
    "agent",
    AGENT_PASSWORD,
  );
  await ensureUser(
    db,
    tenant.id,
    "reviewer@finlot.ai",
    "Demo Reviewer",
    "reviewer",
    AGENT_PASSWORD,
  );

  await ensureChannel(db, tenant.id, "email", "docs@finlot.example.com", {
    imapHost: "imap.example.com",
    imapPort: 993,
    imapUser: "docs@finlot.example.com",
  });
  await ensureChannel(db, tenant.id, "whatsapp", "+918000000001", {
    phoneNumberId: "demo-phone-number-id",
  });

  const loanWf = await ensureWorkflow(db, tenant.id, {
    ...LOAN_WF,
    stages: LOAN_STAGES,
    fields: LEAD_FIELDS,
    fieldConfigName: LOAN_WF.name,
    requirements: LOAN_REQS,
  });
  const admissionWf = await ensureWorkflow(db, tenant.id, {
    ...ADMISSION_WF,
    stages: ADMISSION_STAGES,
    fields: ADMISSION_FIELDS,
    fieldConfigName: "Admission details",
    requirements: ADMISSION_REQS,
  });
  const companyWf = await ensureWorkflow(db, tenant.id, {
    ...COMPANY_WF,
    stages: COMPANY_STAGES,
    fields: REGISTRATION_FIELDS,
    fieldConfigName: "Registration details",
    requirements: COMPANY_REQS,
  });

  const loadStages = async (workflowId: string) =>
    db
      .select({ id: schema.workflowStages.id, name: schema.workflowStages.name })
      .from(schema.workflowStages)
      .where(eq(schema.workflowStages.workflowId, workflowId));

  const loadReqs = async (workflowId: string) =>
    db
      .select({
        id: schema.documentRequirements.id,
        key: schema.documentRequirements.key,
        label: schema.documentRequirements.label,
      })
      .from(schema.documentRequirements)
      .where(eq(schema.documentRequirements.workflowId, workflowId));

  const loanStages = await loadStages(loanWf.id);
  const loanReqs = await loadReqs(loanWf.id);
  const admissionStages = await loadStages(admissionWf.id);
  const admissionReqs = await loadReqs(admissionWf.id);
  const companyStages = await loadStages(companyWf.id);
  const companyReqs = await loadReqs(companyWf.id);

  const summary = {
    casesCreated: 0,
    casesSkipped: 0,
    unmatchedCreated: 0,
  };

  const owners = [owner.id, agent.id];
  let ownerIdx = 0;

  for (const spec of [...LOAN_CASES, ...ADMISSION_CASES, ...COMPANY_CASES]) {
    const workflowId =
      spec.workflowSlug === "business-loan"
        ? loanWf.id
        : spec.workflowSlug === "college-admissions"
          ? admissionWf.id
          : companyWf.id;
    const stages =
      spec.workflowSlug === "business-loan"
        ? loanStages
        : spec.workflowSlug === "college-admissions"
          ? admissionStages
          : companyStages;
    const requirements =
      spec.workflowSlug === "business-loan"
        ? loanReqs
        : spec.workflowSlug === "college-admissions"
          ? admissionReqs
          : companyReqs;

    const result = await seedCaseBundle(db, {
      tenantId: tenant.id,
      ownerId: owners[ownerIdx % owners.length],
      authorName: ownerIdx % 2 === 0 ? "Demo Admin" : "Demo Agent",
      spec,
      stages,
      requirements,
      workflowId,
    });
    ownerIdx++;
    if (result.created) summary.casesCreated++;
    else summary.casesSkipped++;
  }

  summary.unmatchedCreated = await seedUnmatched(db, tenant.id);
  const attachmentsCreated = await seedConversationAttachments(db, tenant.id);
  const notificationsCreated = await seedNotifications(db, tenant.id);

  // Soft-deleted contact leftover for the contacts screen delete UX (optional 1).
  const ghostEmail = "deleted.contact@example.com";
  const ghost = await db
    .select()
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.tenantId, tenant.id),
        eq(schema.contacts.email, ghostEmail),
      ),
    )
    .limit(1);
  if (!ghost[0]) {
    await db.insert(schema.contacts).values({
      tenantId: tenant.id,
      kind: "person",
      name: "Deleted Demo Contact",
      email: ghostEmail,
      phone: "+91 90000 00000",
      deletedAt: new Date(),
      deletedBy: owner.id,
    });
  }

  // Keep live contacts queryable - ensure we didn't leave orphans without cases.
  const liveContacts = await db
    .select({ n: schema.contacts.id })
    .from(schema.contacts)
    .where(
      and(
        eq(schema.contacts.tenantId, tenant.id),
        isNull(schema.contacts.deletedAt),
      ),
    );

  console.log(
    `Dummy seed for tenant "${tenant.slug}": ` +
    `casesCreated=${summary.casesCreated} casesSkipped=${summary.casesSkipped} ` +
    `unmatchedCreated=${summary.unmatchedCreated} conversationAttachments=${attachmentsCreated} ` +
    `notificationsCreated=${notificationsCreated} ` +
    `liveContacts=${liveContacts.length} storageRoot=${STORAGE_ROOT}`,
  );
  console.log("Logins:");
  console.log(
    `  owner    admin@finlot.ai / ${process.env.SEED_ADMIN_PASSWORD ?? "DocketAdmin!2026"}`,
  );
  console.log(`  agent    agent@finlot.ai / ${AGENT_PASSWORD}`);
  console.log(`  reviewer reviewer@finlot.ai / ${AGENT_PASSWORD}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
