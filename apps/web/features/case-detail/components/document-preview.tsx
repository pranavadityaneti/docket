"use client";
/* eslint-disable react-hooks/set-state-in-effect -- reset preview state when target changes */

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
import { AuthRequiredError } from "@/lib/http";
import { fetchDocumentContent } from "@/features/case-detail/api";
import * as React from "react";
import { previewKind, type PreviewTarget } from "./meta";

export function DocumentPreviewDialog({
  doc,
  onClose,
}: {
  doc: PreviewTarget | null;
  onClose: () => void;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!doc) {
      setUrl(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setUrl(null);
    void (async () => {
      try {
        const blob = await fetchDocumentContent(doc.id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (cause) {
        if (cancelled || cause instanceof AuthRequiredError) return;
        setError(cause instanceof Error ? cause.message : "Could not load the file.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [doc]);

  const kind = doc ? previewKind(doc.fileName, doc.mimeType) : "other";
  return (
    <Dialog open={!!doc} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="gap-0 p-0 sm:max-w-3xl">
        <DialogHeader className="border-b">
          <DialogTitle className="truncate pr-2" title={doc?.fileName}>
            {doc?.fileName ?? "Preview"}
          </DialogTitle>
          <DialogDescription>
            {kind === "other"
              ? "This file type cannot be shown inline - download it to open."
              : "Staff preview of the stored file."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[280px] max-h-[70vh] flex-col items-center justify-center bg-muted/30 px-5 py-4">
          {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name="progress_activity" size={18} className="animate-spin" />Loading preview…</div> : null}
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {!loading && !error && url && kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element -- blob: URL from authenticated fetch
            <img src={url} alt={doc?.fileName ?? "Document"} className="max-h-[65vh] max-w-full rounded-[12px] object-contain" />
          ) : null}
          {!loading && !error && url && kind === "pdf" ? <iframe title={doc?.fileName ?? "PDF preview"} src={url} className="h-[65vh] w-full rounded-[12px] border bg-background" /> : null}
          {!loading && !error && url && kind === "other" ? <div className="flex flex-col items-center gap-3 text-center"><Icon name="draft" size={36} className="text-muted-foreground" /><p className="max-w-sm text-sm text-muted-foreground">No in-browser preview for this type. Download to open it on your machine.</p></div> : null}
        </div>
        <DialogFooter className="border-t">
          {url ? <Button variant="outline" className="gap-1.5" onClick={() => { const anchor = document.createElement("a"); anchor.href = url; anchor.download = doc?.fileName ?? "document"; anchor.click(); }}><Icon name="download" size={15} /> Download</Button> : null}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
