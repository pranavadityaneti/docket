import { apiFetch } from "@/lib/http";
import type { BulkDeleteResult, PageResult } from "@/features/shared/types";

export type { BulkDeleteResult, PageResult } from "@/features/shared/types";

export type ApiContact = {
  id: string;
  kind: "person" | "organisation";
  name: string;
  organisation: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  caseCount: number;
  lastCaseAt: string | null;
};

export type ContactDeletePreview = { id: string; name: string; caseCount: number }[];

export type ListContactsOpts = {
  limit?: number;
  offset?: number;
};

function contactsQuery(opts: ListContactsOpts = {}): string {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function listContacts(opts: ListContactsOpts = {}): Promise<PageResult<ApiContact>> {
  return apiFetch<PageResult<ApiContact>>(`/contacts${contactsQuery(opts)}`);
}

export function previewDeleteContacts(ids: string[]): Promise<ContactDeletePreview> {
  return apiFetch<ContactDeletePreview>("/contacts/delete-preview", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export function deleteContacts(ids: string[]): Promise<BulkDeleteResult> {
  return apiFetch<BulkDeleteResult>("/contacts/delete", {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
}

export { contactsQuery as buildContactsQuery };
