import { apiFetch } from "@/lib/http";
import type { PageResult } from "@/features/shared/types";

export type { PageResult } from "@/features/shared/types";

export type ApiFollowUp = {
  caseId: string;
  reference: string;
  subjectName: string | null;
  subjectOrganisation: string | null;
  stageName: string | null;
  workflowName: string;
  outstanding: number;
  requestsSent: number;
  remindersSent: number;
  lastRequestAt: string | null;
  daysSinceLastRequest: number | null;
  paused: boolean;
  reminderDue: boolean;
  unreachable: boolean;
};

export type ListFollowUpsOpts = {
  limit?: number;
  offset?: number;
};

function followUpsQuery(opts: ListFollowUpsOpts = {}): string {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listFollowUps(
  opts: ListFollowUpsOpts = {},
): Promise<PageResult<ApiFollowUp>> {
  return apiFetch<PageResult<ApiFollowUp>>(`/follow-ups${followUpsQuery(opts)}`);
}
