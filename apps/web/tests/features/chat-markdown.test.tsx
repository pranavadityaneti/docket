/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMarkdown } from "@/features/case-detail/components/chat-markdown";

describe("ChatMarkdown", () => {
  it("renders bold, italic, and lists", () => {
    render(
      <ChatMarkdown text={"Hello **world** and *there*\n\n- one\n- two"} />,
    );
    expect(screen.getByText("world").tagName).toBe("STRONG");
    expect(screen.getByText("there").tagName).toBe("EM");
    expect(screen.getByText("one").closest("li")).toBeTruthy();
  });

  it("only allows safe link schemes", () => {
    const { container } = render(
      <ChatMarkdown text={"[ok](https://finlot.ai) [bad](javascript:alert(1))"} />,
    );
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe("https://finlot.ai");
    expect(container.textContent).toContain("bad");
  });
});
