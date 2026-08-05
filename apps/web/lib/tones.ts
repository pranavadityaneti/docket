/**
 * Stage badge colours keyed by the workflow stage's `tone` field.
 * Unknown tones fall back to muted rather than rendering unstyled.
 */
export const TONE_CLASS: Record<string, string> = {
  muted: "border-transparent bg-muted text-muted-foreground",
  teal: "border-transparent bg-pastel-mint text-pastel-mint-fg",
  primary: "border-transparent bg-pastel-mint text-pastel-mint-fg",
  amber: "border-transparent bg-pastel-peach text-pastel-peach-fg",
  orange: "border-transparent bg-pastel-peach text-pastel-peach-fg",
  green: "border-transparent bg-pastel-mint text-pastel-mint-fg",
  red: "border-transparent bg-red-50 text-red-600",
};

export function toneClass(tone: string | null | undefined): string {
  return TONE_CLASS[tone ?? ""] ?? TONE_CLASS.muted;
}
