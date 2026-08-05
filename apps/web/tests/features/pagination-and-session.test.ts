import { describe, expect, it } from "vitest";
import { buildCasesQuery } from "@/features/cases/api";
import { buildContactsQuery } from "@/features/contacts/api";
import { API_URL, SESSION_COOKIE } from "@/lib/http";

describe("list query builders", () => {
  it("builds cases query with workflow + pagination", () => {
    expect(buildCasesQuery()).toBe("");
    expect(buildCasesQuery({ workflow: "college" })).toBe("?workflow=college");
    expect(buildCasesQuery({ limit: 50, offset: 100 })).toBe("?limit=50&offset=100");
    expect(buildCasesQuery({ workflow: "a b", limit: 10, offset: 0 })).toBe(
      "?workflow=a+b&limit=10&offset=0",
    );
  });

  it("builds contacts query", () => {
    expect(buildContactsQuery()).toBe("");
    expect(buildContactsQuery({ limit: 25, offset: 50 })).toBe("?limit=25&offset=50");
  });
});

describe("session defaults", () => {
  it("defaults API to same-origin /api proxy", () => {
    expect(API_URL).toBe("/api");
  });

  it("exposes the readable session cookie name", () => {
    expect(SESSION_COOKIE).toBe("docket_session");
  });
});
