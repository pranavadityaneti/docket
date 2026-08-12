/**
 * Inbound mail often stores Apple Mail's text/plain stub
 * `[image: Screenshot ….png]` even when the real file is already linked as
 * an attachment tile. Strip those once we have a matching file name so the
 * bubble doesn't look like the image went missing.
 */
const IMAGE_PLACEHOLDER_RE = /\[image:\s*([^\]]+)\]/gi;

export function stripResolvedImagePlaceholders(
  bodyText: string,
  attachmentFileNames: Iterable<string>,
): string {
  const kept = new Set(
    [...attachmentFileNames].map((n) => n.trim().toLowerCase()).filter(Boolean),
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
