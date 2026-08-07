import { describe, expect, it } from "vitest";
import { parseCaseTab, previewKind, TABS } from "@/features/case-detail/components/meta";
import { cellValue, tableFields, toLead, toStage } from "@/features/cases/components/types";
import type { ApiCase } from "@/features/cases/api";
import type { ApiFieldDef, ApiWorkflow } from "@/features/workflows/api";

describe("parseCaseTab", () => {
  it("defaults to checklist", () => {
    expect(parseCaseTab(null)).toBe("checklist");
    expect(parseCaseTab("nope")).toBe("checklist");
  });

  it("accepts known tabs", () => {
    for (const t of TABS) {
      expect(parseCaseTab(t.key)).toBe(t.key);
    }
  });
});

describe("previewKind", () => {
  it("detects images and pdfs by mime and extension", () => {
    expect(previewKind("x.png", "image/png")).toBe("image");
    expect(previewKind("x.pdf", "application/pdf")).toBe("pdf");
    expect(previewKind("scan.PDF", null)).toBe("pdf");
    expect(previewKind("notes.docx", null)).toBe("other");
  });
});

describe("cases types helpers", () => {
  it("toStage never invents Pending", () => {
    expect(toStage(null)).toBe("-");
    expect(toStage(" Under review ")).toBe("Under review");
  });

  it("toLead maps API case to UI lead", () => {
    const row: ApiCase = {
      id: "1",
      reference: "DKT-1",
      source: "Email",
      data: { course: "BTech" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      subjectName: "Ada",
      subjectOrganisation: "College",
      subjectEmail: "a@b.c",
      subjectPhone: null,
      stageId: "s1",
      stageName: "Docs",
      stageTone: "amber",
      ownerId: null,
      ownerName: null,
    };
    const lead = toLead(row);
    expect(lead.name).toBe("Ada");
    expect(lead.company).toBe("College");
    expect(lead.stage).toBe("Docs");
    expect(lead.owner).toBe("Unassigned");
    expect(lead.data?.course).toBe("BTech");
  });

  it("toLead uses ownerName when present", () => {
    const row: ApiCase = {
      id: "1",
      reference: "DKT-1",
      source: null,
      data: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      subjectName: "Ada",
      subjectOrganisation: null,
      subjectEmail: null,
      subjectPhone: null,
      stageId: null,
      stageName: null,
      stageTone: null,
      ownerId: "u1",
      ownerName: "Priya",
    };
    expect(toLead(row).owner).toBe("Priya");
  });

  it("tableFields respects show_in_table and cap", () => {
    const fields: ApiFieldDef[] = [
      {
        field_key: "a",
        label: "A",
        field_type: "string",
        input_type: "text",
        required: false,
        order: 1,
        show_in_table: true,
      },
      {
        field_key: "b",
        label: "B",
        field_type: "string",
        input_type: "text",
        required: false,
        order: 2,
        show_in_table: false,
      },
      {
        field_key: "c",
        label: "C",
        field_type: "integer",
        input_type: "number",
        required: false,
        order: 3,
        show_in_table: true,
        format: "inr",
      },
    ];
    const wf: ApiWorkflow = {
      id: "w",
      name: "W",
      slug: "w",
      subjectLabel: "Student",
      caseLabel: "Case",
      fields,
    };
    const cols = tableFields(wf);
    expect(cols.map((f) => f.field_key)).toEqual(["a", "c"]);
    expect(cellValue({ c: 1500 }, cols[1]!)).toContain("₹");
    expect(cellValue({}, cols[0]!)).toBe("-");
  });
});
