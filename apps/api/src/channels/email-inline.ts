/**
 * Apple Mail (and a few cousins) put `[image: Screenshot ….png]` in the
 * text/plain part for every embedded CID image. mailparser surfaces those
 * parts as attachments with contentDisposition "inline". We used to drop all
 * inline parts to avoid signature logos polluting the case file list - and
 * with them, the actual screenshots borrowers paste into replies.
 */

export type MailAttachmentLike = {
  content?: Buffer | null;
  contentDisposition?: string | null;
  contentType?: string | null;
  filename?: string | null;
};

/** Bytes below this are almost always signature logos / tracking pixels. */
export const INLINE_IMAGE_MIN_BYTES = 20_000;

const IMAGE_PLACEHOLDER_RE = /\[image:\s*([^\]]+)\]/gi;

export function referencedImageNames(bodyText: string): Set<string> {
  const names = new Set<string>();
  for (const match of bodyText.matchAll(IMAGE_PLACEHOLDER_RE)) {
    const name = match[1]?.trim().toLowerCase();
    if (name) names.add(name);
  }
  return names;
}

export function shouldKeepEmailAttachment(
  att: MailAttachmentLike,
  referencedNames: Set<string>,
): boolean {
  if (!att.content || att.content.length === 0) return false;
  if (att.contentDisposition !== "inline") return true;

  const name = (att.filename ?? "").trim().toLowerCase();
  if (name && referencedNames.has(name)) return true;

  const mime = (att.contentType ?? "").toLowerCase();
  if (mime.startsWith("image/") && att.content.length >= INLINE_IMAGE_MIN_BYTES) {
    return true;
  }
  return false;
}

/**
 * Drop `[image: file.png]` stubs once that file is kept as an attachment -
 * the conversation tile shows the real bytes, the placeholder is just noise.
 */
export function stripResolvedImagePlaceholders(
  bodyText: string,
  keptFileNames: Iterable<string>,
): string {
  const kept = new Set(
    [...keptFileNames].map((n) => n.trim().toLowerCase()).filter(Boolean),
  );
  if (kept.size === 0) return bodyText.trim();

  return bodyText
    .replace(IMAGE_PLACEHOLDER_RE, (full, fileName: string) => {
      const key = fileName.trim().toLowerCase();
      return kept.has(key) ? "" : full;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
