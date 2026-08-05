import { apiFetch } from "@/lib/http";

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

export function listFollowUps(): Promise<ApiFollowUp[]> {
  return apiFetch<ApiFollowUp[]>("/follow-ups");
}
