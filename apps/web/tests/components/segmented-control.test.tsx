/** @vitest-environment jsdom */
import { SegmentedControl } from "@/components/shared/segmented-control";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

describe("SegmentedControl", () => {
  it("calls onChange and marks the pressed option", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl
        aria-label="Case display"
        value="Table"
        onChange={onChange}
        options={[
          { value: "Table", label: "Table" },
          { value: "Board", label: "Board" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Board" }));
    expect(onChange).toHaveBeenCalledWith("Board");

    rerender(
      <SegmentedControl
        aria-label="Case display"
        value="Board"
        onChange={onChange}
        options={[
          { value: "Table", label: "Table" },
          { value: "Board", label: "Board" },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Board" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });
});
