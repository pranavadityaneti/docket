import { describe, expect, it } from "vitest";
import {
  parseBoardDragPayload,
  shouldMoveOnDrop,
} from "@/features/cases/components/board-view";

describe("board drag helpers", () => {
  it("parses a valid payload", () => {
    expect(
      parseBoardDragPayload(
        JSON.stringify({ leadId: "c1", fromStage: "Pending" }),
      ),
    ).toEqual({ leadId: "c1", fromStage: "Pending" });
  });

  it("rejects junk", () => {
    expect(parseBoardDragPayload("")).toBeNull();
    expect(parseBoardDragPayload("{")).toBeNull();
    expect(parseBoardDragPayload(JSON.stringify({ leadId: "c1" }))).toBeNull();
  });

  it("moves only across stages", () => {
    const payload = { leadId: "c1", fromStage: "Pending" };
    expect(shouldMoveOnDrop(payload, "Pending")).toBe(false);
    expect(shouldMoveOnDrop(payload, "Follow up")).toBe(true);
  });

  /**
   * Regression note for the faded-card bug: drop clears drag UI state before
   * the optimistic stage move remounts the card (unmount skips dragend).
   */
  it("documents cross-stage drop as the fade-bug case", () => {
    const payload = { leadId: "neha", fromStage: "Filed" };
    expect(shouldMoveOnDrop(payload, "Query raised")).toBe(true);
  });
});
