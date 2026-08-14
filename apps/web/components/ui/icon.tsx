import { cn } from "@/lib/utils";

type IconProps = {
  /** Material Symbols ligature name, e.g. "dashboard", "person_search". */
  name: string;
  /** Pixel size (also drives the optical-size axis). */
  size?: number;
  /** Solid (filled) vs outlined glyph. */
  fill?: boolean;
  /** Stroke weight axis, 100–700. */
  weight?: number;
  className?: string;
};

export function Icon({
  name,
  size = 20,
  fill = false,
  weight = 400,
  className,
}: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("material-symbols-outlined shrink-0", className)}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${fill ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${size}`,
      }}
    >
      {name}
    </span>
  );
}
