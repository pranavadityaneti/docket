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
import * as React from "react";

/* ------------------------------------------------------------------ *
 * The confirmation before a delete.
 *
 * "Are you sure?" is not a safeguard - people click through it without
 * reading. This shows what is actually about to happen, in specifics
 * loaded from the server ("7 documents, including a borrower's Aadhaar
 * and PAN"), and asks for the word DELETE to be typed, so the action
 * cannot be completed by muscle memory.
 * ------------------------------------------------------------------ */

export type DeleteLine = { id: string; label: string; detail?: string; blocked?: string };

export function DeleteDialog({
  open,
  onOpenChange,
  title,
  /** What survives, and what stops working - the honest consequences. */
  consequences,
  lines,
  loading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  consequences: React.ReactNode;
  lines: DeleteLine[];
  loading: boolean;
  onConfirm: () => Promise<void>;
}) {
  const [typed, setTyped] = React.useState("");
  const [working, setWorking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset whenever the dialog opens for a different set, so a previously
  // typed DELETE can never carry over into a fresh confirmation.
  const [openedFor, setOpenedFor] = React.useState<string | null>(null);
  const key = lines.map((l) => l.id).join(",");
  if (open && openedFor !== key) {
    setOpenedFor(key);
    setTyped("");
    setError(null);
  }

  const deletable = lines.filter((l) => !l.blocked);
  const blocked = lines.filter((l) => l.blocked);
  const armed = typed.trim().toUpperCase() === "DELETE" && deletable.length > 0 && !working;

  async function confirm() {
    if (!armed) return;
    setWorking(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (working ? null : onOpenChange(o))}>
      <DialogContent className="gap-0 p-0">
        <DialogHeader className="border-b pr-10">
          <DialogTitle className="flex items-center gap-2">
            <Icon name="warning" size={18} className="text-danger" />
            {title}
          </DialogTitle>
          <DialogDescription>This cannot be undone from here.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-4 rounded-md border border-danger-border bg-danger-muted p-3 text-sm text-danger-muted-foreground">
            {consequences}
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">Checking what this affects…</p>
          ) : (
            <>
              {deletable.length > 0 ? (
                <div className="mb-3">
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Will be deleted ({deletable.length})
                  </div>
                  <div className="flex flex-col gap-1">
                    {deletable.map((l) => (
                      <div
                        key={l.id}
                        className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                      >
                        <span className="font-medium">{l.label}</span>
                        {l.detail ? (
                          <span className="text-xs text-muted-foreground">{l.detail}</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Shown, not silently dropped: someone who selected ten rows
                  needs to know which two will not go and why. */}
              {blocked.length > 0 ? (
                <div>
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Cannot be deleted ({blocked.length})
                  </div>
                  <div className="flex flex-col gap-1">
                    {blocked.map((l) => (
                      <div
                        key={l.id}
                        className="rounded-md border bg-muted/40 px-3 py-2 text-sm"
                      >
                        <div className="font-medium">{l.label}</div>
                        <div className="text-xs text-muted-foreground">{l.blocked}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}

          {deletable.length > 0 ? (
            <div className="mt-4">
              <label className="text-sm font-medium">
                Type <span className="font-mono">DELETE</span> to confirm
              </label>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="DELETE"
                className="mt-1.5"
                autoComplete="off"
              />
            </div>
          ) : null}
        </div>

        {error ? (
          <div className="flex items-center gap-1.5 border-t bg-danger-muted px-4 py-2 text-sm text-danger">
            <Icon name="error" size={15} /> {error}
          </div>
        ) : null}

        <DialogFooter className="flex-row justify-end gap-2 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirm()}
            disabled={!armed}
            className="gap-1.5"
          >
            {working ? (
              <>
                <Icon name="progress_activity" size={16} className="animate-spin" /> Deleting…
              </>
            ) : (
              <>
                <Icon name="delete" size={16} /> Delete {deletable.length || ""}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
