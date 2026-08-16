import { DOCKET_MARK_SRC, DocketMark, DocketWatermark } from "@/components/brand/docket-mark";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("DocketMark", () => {
  it("uses the brand file, not inline svg", () => {
    const html = renderToStaticMarkup(createElement(DocketMark));
    expect(html).toContain(`src="${DOCKET_MARK_SRC}"`);
    expect(html).not.toContain("<svg");
  });
});

describe("DocketWatermark", () => {
  it("labels the lockup as powered by Docket", () => {
    const html = renderToStaticMarkup(createElement(DocketWatermark));
    expect(html).toContain("Powered by");
    expect(html).toContain(`src="${DOCKET_MARK_SRC}"`);
  });
});
