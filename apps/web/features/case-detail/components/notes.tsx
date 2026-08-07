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
  return (
    <div className="flex w-full items-center gap-2">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
        }}
        placeholder={placeholder}
        className="text-sm"
      />
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        disabled={busy || !text.trim()}
        onClick={() => void submit()}
      >
        {busy ? "Posting…" : "Add note"}
      </Button>
    </div>
  );
}

/** One checklist note as a bullet - keeps author/time quiet on the same line. */
export function NoteLine({ note }: { note: ApiCaseEvent }) {
  return (
    <li className="text-sm leading-snug">
      <span className="whitespace-pre-wrap break-words">{note.body}</span>
      <span className="mt-0.5 block text-xs text-muted-foreground">
        {note.authorName ?? "Unknown"} · {formatDateTime(note.createdAt)}
      </span>
    </li>
  );
}

/** All notes for one checklist item - always a bulleted list when any exist. */
export function NoteList({ notes }: { notes: ApiCaseEvent[] }) {
  if (notes.length === 0) return null;
  // Case events arrive newest-first; bullets read top→bottom as written.
  const chronological = [...notes].reverse();
  return (
    <ul className="list-disc space-y-2 pl-5 text-foreground marker:text-muted-foreground">
      {chronological.map((note) => (
        <NoteLine key={note.id} note={note} />
      ))}
    </ul>
  );
}
