/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { escapeCsvCell, toCsv, useSelection } from "@/components/shared/bulk-select";

describe("useSelection", () => {
  it("prunes selection to visible ids", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useSelection(ids),
      { initialProps: { ids: ["a", "b", "c"] } },
    );

    act(() => {
      result.current.toggle("a");
      result.current.toggle("b");
    });
    expect(result.current.count).toBe(2);

    rerender({ ids: ["b", "c"] });
    expect(result.current.count).toBe(1);
    expect(result.current.isSelected("a")).toBe(false);
    expect(result.current.isSelected("b")).toBe(true);
  });

  it("deselects all visible even when hidden ids linger", () => {
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useSelection(ids),
      { initialProps: { ids: ["a", "b", "c"] } },
    );

    act(() => {
      result.current.toggleAll();
    });
    expect(result.current.allSelected).toBe(true);

    rerender({ ids: ["a", "b"] });
    expect(result.current.allSelected).toBe(true);

    act(() => {
      result.current.toggleAll();
    });
    expect(result.current.count).toBe(0);
  });
});

describe("CSV escape", () => {
  it("prefixes formula-like cells", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("+cmd")).toBe("'+cmd");
    expect(escapeCsvCell("@sum")).toBe("'@sum");
    expect(escapeCsvCell("normal")).toBe("normal");
  });

  it("quotes delimiters and doubles quotes", () => {
    const csv = toCsv([{ name: 'a,b"c' }], [
      { header: "Name", value: (r: { name: string }) => r.name },
    ]);
    expect(csv).toContain('"a,b""c"');
    expect(csv.startsWith("Name\r\n")).toBe(true);
  });
});
