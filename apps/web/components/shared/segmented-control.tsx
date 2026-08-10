"use client";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import * as React from "react";

export type SegmentOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: string;
};

type SegmentedControlProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: readonly SegmentOption<T>[];
  /** Accessible name for the control. */
  "aria-label": string;
  /**
   * `group` — view / mode toggles (`aria-pressed`).
   * `tablist` — filter tabs that swap content (`role=tab`).
   */
  role?: "group" | "tablist";
  className?: string;
};

type Pill = { left: number; top: number; width: number; height: number };

/**
 * Cases-style segment control with a sliding “pill” background
 * (tab-bar motion instead of the active fill popping on/off).
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
  role = "group",
  className,
}: SegmentedControlProps<T>) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const btnRefs = React.useRef(new Map<T, HTMLButtonElement>());
  const [pill, setPill] = React.useState<Pill | null>(null);
  const [motionOn, setMotionOn] = React.useState(false);

  const syncPill = React.useCallback(() => {
    const root = rootRef.current;
    const btn = btnRefs.current.get(value);
    if (!root || !btn) return;
    const rootRect = root.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    setPill({
      left: btnRect.left - rootRect.left,
      top: btnRect.top - rootRect.top,
      width: btnRect.width,
      height: btnRect.height,
    });
  }, [value]);

  React.useLayoutEffect(() => {
    syncPill();
    // Enable transform transitions only after the first measure so
    // the pill does not animate in from (0,0) on mount.
    const id = requestAnimationFrame(() => setMotionOn(true));
    return () => cancelAnimationFrame(id);
  }, [syncPill, options]);

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => syncPill());
    ro.observe(root);
    for (const btn of btnRefs.current.values()) ro.observe(btn);
    window.addEventListener("resize", syncPill);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncPill);
    };
  }, [syncPill, options]);

  const isTablist = role === "tablist";

  return (
    <div
      ref={rootRef}
      role={role}
      aria-label={ariaLabel}
      className={cn(
        "relative inline-flex w-fit items-center gap-1 rounded-[12px] bg-muted p-1",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0 left-0 rounded-[8px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
          motionOn &&
            "transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          !pill && "opacity-0",
        )}
        style={
          pill
            ? {
                width: pill.width,
                height: pill.height,
                transform: `translate3d(${pill.left}px, ${pill.top}px, 0)`,
              }
            : undefined
        }
      />
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            ref={(node) => {
              if (node) btnRefs.current.set(opt.value, node);
              else btnRefs.current.delete(opt.value);
            }}
            type="button"
            role={isTablist ? "tab" : undefined}
            aria-selected={isTablist ? active : undefined}
            aria-pressed={!isTablist ? active : undefined}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative z-10 flex h-[34px] items-center gap-1.5 rounded-[8px] px-3.5 text-sm transition-colors",
              active
                ? "font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.icon ? <Icon name={opt.icon} size={16} /> : null}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
