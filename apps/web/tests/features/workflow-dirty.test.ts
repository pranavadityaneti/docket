import { describe, expect, it } from "vitest";
import {
  snapFields,
  snapIdentity,
  snapRequirements,
  snapStages,
} from "@/features/workflows/draft-snapshots";

describe("workflow editor dirty snapshots", () => {
  it("identity ignores trailing spaces", () => {
    expect(snapIdentity("Loan ", " Borrower", "Case ", "  ")).toBe(
      snapIdentity("Loan", "Borrower", "Case", ""),
    );
    expect(snapIdentity("A", "B", "C", "x")).not.toBe(
      snapIdentity("A", "B", "C", "y"),
    );
  });

  it("stages dirty when order or tone changes", () => {
    const a = [
      { _clientId: "1", id: "1", name: "Pending", tone: "muted", position: 0 },
      { _clientId: "2", id: "2", name: "Done", tone: "green", position: 1 },
    ];
    const swapped = [a[1]!, a[0]!];
    expect(snapStages(a)).not.toBe(snapStages(swapped));
    expect(snapStages(a)).not.toBe(
      snapStages([{ ...a[0]!, tone: "red" }, a[1]!]),
    );
    expect(snapStages(a)).toBe(snapStages([...a]));
  });

  it("fields dirty when label changes", () => {
    const f = {
      _clientId: "pan",
      keyLocked: true,
      field_key: "pan",
      label: "PAN",
      field_type: "string" as const,
      input_type: "text" as const,
      required: true,
      order: 0,
    };
    expect(snapFields([f])).not.toBe(
      snapFields([{ ...f, label: "PAN Number" }]),
    );
  });

  it("requirements dirty when checklist grows", () => {
    const empty = snapRequirements([]);
    const one = snapRequirements([
      {
        _clientId: "t1",
        key: "pan",
        keyLocked: false,
        label: "PAN",
        description: "",
        required: true,
        maxFiles: 1,
        reusable: false,
        validityDays: "",
        conditionField: "",
        conditionEquals: "",
        position: 0,
      },
    ]);
    expect(empty).not.toBe(one);
  });
});
