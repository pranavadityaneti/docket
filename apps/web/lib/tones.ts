/**
 * Stage / status class recipes.
 *
 * Hex values + Tailwind colour tokens live ONLY in `styles/colors.css`.
 * These strings just name those tokens — edit colours there, not here.
 */

/** Soft danger strip (errors above tables/cards). */
export const DANGER_BANNER =
  "border border-danger-border bg-danger-muted text-danger-muted-foreground";

/** Soft success strip. */
export const SUCCESS_BANNER =
  "border border-success-border bg-success-muted text-success-muted-foreground";

/** Soft warning / brick strip. */
export const WARNING_BANNER =
  "border border-warning-border bg-warning-muted text-warning-muted-foreground";

/** Soft info strip. */
export const INFO_BANNER =
  "border border-info-border bg-info-muted text-info-muted-foreground";

/** Soft sky strip (received / inbound). */
export const SKY_BANNER =
  "border border-sky-border bg-sky-muted text-sky-muted-foreground";

/** Outline badge tones (no explicit border colour unless using *-BANNER). */
export const TONE_CLASS: Record<string, string> = {
  muted: "border-transparent bg-muted text-muted-foreground",
  teal: "border-transparent bg-pastel-mint text-pastel-mint-fg",
  primary: "border-transparent bg-pastel-mint text-pastel-mint-fg",
  amber: "border-transparent bg-pastel-peach text-pastel-peach-fg",
  orange: "border-transparent bg-pastel-peach text-pastel-peach-fg",
  green: "border-transparent bg-pastel-mint text-pastel-mint-fg",
  red: "border-transparent bg-danger-muted text-danger",
};

/** Solid chip for tone pickers / colour previews. */
export const TONE_SWATCH: Record<string, string> = {
  muted: "bg-muted",
  teal: "bg-pastel-mint",
  primary: "bg-pastel-mint",
  amber: "bg-pastel-peach",
  orange: "bg-pastel-peach",
  green: "bg-pastel-mint",
  red: "bg-danger-muted",
};

export function toneClass(tone: string | null | undefined): string {
  return TONE_CLASS[tone ?? ""] ?? TONE_CLASS.muted;
}

export function toneSwatch(tone: string | null | undefined): string {
  return TONE_SWATCH[tone ?? ""] ?? TONE_SWATCH.muted;
}
