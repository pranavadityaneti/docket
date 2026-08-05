import { apiFetch } from "@/lib/http";

export type ApiAttentionItem = {
  caseId: string;
  reference: string;
  subjectName: string | null;
  subjectOrganisation: string | null;
  stageName: string | null;
  outstanding: number;
  awaitingReview: number;
  updatedAt: string;
};

export type ApiOverview = {
  totals: {
    cases: number;
    casesNeedingAttention: number;
    casesComplete: number;
    documentsAwaitingReview: number;
    documentsOutstanding: number;
  };
  attention: ApiAttentionItem[];
  intake: Record<string, number>;
};

export function getOverview(): Promise<ApiOverview> {
  return apiFetch<ApiOverview>("/overview");
}
