"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiCaseEvent } from "@/features/case-detail/api";
import { formatDateTime } from "@/lib/format";
import * as React from "react";

export function NoteComposer({
  placeholder,
  onSubmit,
}: {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function submit() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      await onSubmit(body);
      setText("");
    } catch {
      // The caller has already surfaced the error; preserve what was typed.
    } finally {
      setBusy(false);
    }
  }
  return <div className="flex w-full items-center gap-2"><Input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder={placeholder} className="text-sm" /><Button size="sm" variant="outline" className="shrink-0" disabled={busy || !text.trim()} onClick={() => void submit()}>{busy ? "Posting…" : "Add note"}</Button></div>;
}

export function NoteLine({ note }: { note: ApiCaseEvent }) {
  return <div className="rounded-[12px] border bg-muted/40 px-3 py-2 text-sm"><div className="whitespace-pre-wrap break-words">{note.body}</div><div className="mt-1 text-xs text-muted-foreground">{note.authorName ?? "Unknown"} · {formatDateTime(note.createdAt)}</div></div>;
}
