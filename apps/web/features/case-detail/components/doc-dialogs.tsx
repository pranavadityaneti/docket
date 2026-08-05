"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type { ApiDocument } from "@/features/case-detail/api";
import * as React from "react";
import { StatusBadge } from "./status-badge";

export function RejectDialog({ doc, onCancel, onConfirm }: { doc: ApiDocument | null; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [forDoc, setForDoc] = React.useState<string | null>(null);
  if (doc && doc.id !== forDoc) { setForDoc(doc.id); setReason(""); setTouched(false); }
  const invalid = !reason.trim();
  return <Dialog open={!!doc} onOpenChange={(next) => !next && onCancel()}><DialogContent><DialogHeader><DialogTitle>Reject this document</DialogTitle><DialogDescription>The reason is shown to your team and is what the follow-up message will quote - write it as you would say it to the sender.</DialogDescription></DialogHeader><div className="px-5 py-1"><div className="mb-2 truncate text-sm text-muted-foreground">{doc?.fileName}</div><Input value={reason} autoFocus maxLength={500} placeholder="e.g. Page 2 is cut off - please resend the full statement" onChange={(event) => setReason(event.target.value)} onBlur={() => setTouched(true)} onKeyDown={(event) => { if (event.key === "Enter" && !invalid) onConfirm(reason.trim()); }} />{touched && invalid ? <p className="mt-1 text-xs text-red-600 dark:text-red-400">A reason is required - the API rejects a rejection without one.</p> : null}</div><DialogFooter><Button variant="outline" onClick={onCancel}>Cancel</Button><Button variant="destructive" disabled={invalid} onClick={() => onConfirm(reason.trim())}>Reject document</Button></DialogFooter></DialogContent></Dialog>;
}

export function RemoveDialog({ doc, onCancel, onConfirm }: { doc: ApiDocument | null; onCancel: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = React.useState("");
  const [forDoc, setForDoc] = React.useState<string | null>(null);
  if (doc && doc.id !== forDoc) { setForDoc(doc.id); setReason(""); }
  return <Dialog open={!!doc} onOpenChange={(next) => !next && onCancel()}><DialogContent><DialogHeader><DialogTitle>Remove this document?</DialogTitle><DialogDescription>The file is deleted permanently - this cannot be undone. A record of the removal is kept, showing the file name and who removed it.</DialogDescription></DialogHeader><div className="px-5 py-1"><div className="mb-3 flex items-center gap-2 rounded-[12px] border bg-muted/40 px-3 py-2"><Icon name="description" size={16} className="shrink-0 text-muted-foreground" /><span className="truncate text-sm">{doc?.fileName}</span>{doc ? <StatusBadge status={doc.status} /> : null}</div><label className="mb-1 block text-xs font-medium text-muted-foreground">Reason (optional)</label><Input value={reason} autoFocus maxLength={500} placeholder="e.g. Wrong file - belongs to another applicant" onChange={(event) => setReason(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onConfirm(reason.trim()); }} /></div><DialogFooter><Button variant="outline" onClick={onCancel}>Cancel</Button><Button variant="destructive" onClick={() => onConfirm(reason.trim())}>Remove permanently</Button></DialogFooter></DialogContent></Dialog>;
}
