"use client";
/* eslint-disable react-hooks/set-state-in-effect -- blob URL lifecycle follows attachment id */

import { Icon } from "@/components/ui/icon";
import { useToast } from "@/components/ui/toast";
import { fetchDocumentContent } from "@/features/case-detail/api";
import type { ApiConversationAttachment } from "@/features/case-detail/api";
import { AuthRequiredError } from "@/lib/http";
import * as React from "react";
import { previewKind, type PreviewTarget } from "./meta";

function fileExt(fileName: string): string {
  const ext = fileName.split(".").pop()?.toUpperCase() ?? "";
  return ext.length > 0 && ext.length <= 5 ? ext : "FILE";
}

/**
 * WhatsApp-style square attachment tile. Images show a cover thumbnail;
 * PDFs / other files show an icon tile. Soft-deleted checklist files keep a
 * dashed placeholder - tap explains why via toast (bytes are gone).
 */
export function AttachmentTile({
  file,
  onPreview,
}: {
  file: ApiConversationAttachment;
  onPreview: (doc: PreviewTarget) => void;
}) {
  const toast = useToast();
  const deleted = Boolean(file.deleted);
  const kind = previewKind(file.fileName, file.mimeType);
  const [thumbUrl, setThumbUrl] = React.useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = React.useState(false);

  React.useEffect(() => {
    if (deleted || kind !== "image") {
      setThumbUrl(null);
      setThumbFailed(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setThumbUrl(null);
    setThumbFailed(false);
    void (async () => {
      try {
        const blob = await fetchDocumentContent(file.id);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setThumbUrl(objectUrl);
      } catch (cause) {
        if (cancelled || cause instanceof AuthRequiredError) return;
        setThumbFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, kind, deleted]);

  function handleClick() {
    if (deleted) {
      const reason =
        file.deletionReason?.trim() ||
        "No reason was recorded when it was removed.";
      toast.push({
        title: "This file has been deleted",
        description: `Due to: “${reason}”`,
        tone: "danger",
      });
      return;
    }
    onPreview({
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={
        deleted
          ? `${file.fileName} (deleted)`
          : file.fileName
      }
      aria-label={
        deleted
          ? `${file.fileName} deleted — show reason`
          : `Preview ${file.fileName}`
      }
      className={`group relative size-[4.5rem] shrink-0 overflow-hidden rounded-[10px] border text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        deleted
          ? "border-dashed border-danger-border/80 bg-danger-muted/40 hover:bg-danger-muted/70"
          : "border-border/80 bg-background hover:border-border hover:bg-muted/40"
      }`}
    >
      {deleted ? (
        <div className="flex size-full flex-col items-center justify-center gap-1 px-1.5">
          <Icon name="delete" size={20} className="text-danger" />
          <span className="max-w-full truncate text-[10px] font-semibold tracking-wide text-danger">
            Deleted
          </span>
        </div>
      ) : kind === "image" && thumbUrl && !thumbFailed ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob: URL from authenticated fetch
        <img
          src={thumbUrl}
          alt=""
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1 px-1.5">
          <Icon
            name={
              kind === "pdf"
                ? "picture_as_pdf"
                : kind === "image"
                  ? "image"
                  : "attach_file"
            }
            size={22}
            className={
              kind === "pdf"
                ? "text-danger"
                : "text-muted-foreground"
            }
          />
          <span className="max-w-full truncate text-[10px] font-semibold tracking-wide text-muted-foreground">
            {fileExt(file.fileName)}
          </span>
        </div>
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-3 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
        {file.fileName}
      </span>
    </button>
  );
}
