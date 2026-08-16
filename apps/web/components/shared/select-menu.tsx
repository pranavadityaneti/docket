"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { fieldControlClassName } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type SelectMenuProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** `sm` for dense surfaces (board cards). */
  size?: "default" | "sm";
  id?: string;
  "aria-label"?: string;
};

/**
 * App-styled select. Replaces native <select> so we do not get the OS
 * frosted menu that ignores our radius / theme.
 */
export function SelectMenu({
  value,
  options,
  onChange,
  disabled,
  placeholder = "Choose...",
  className,
  size = "default",
  id,
  "aria-label": ariaLabel,
}: SelectMenuProps) {
  const selected = options.find((o) => o.value === value);
  const isEmpty = !selected && value === "";
  const label = selected?.label ?? (value || placeholder);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn(
              fieldControlClassName,
              "flex cursor-pointer items-center gap-2 text-left",
              size === "sm" &&
              "h-8 rounded-[8px] px-1.5 text-[11px] focus-visible:ring-2",
              isEmpty && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <Icon
          name="expand_more"
          size={size === "sm" ? 14 : 16}
          className="shrink-0 text-muted-foreground"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className={cn(
          "max-h-80 min-w-[var(--anchor-width,12rem)] overflow-y-auto rounded-[12px]",
          size === "sm" && "min-w-44 text-[11px]",
        )}
      >
        <DropdownMenuGroup>
          {options.map((opt) => {
            const isCurrent = opt.value === value;
            return (
              <DropdownMenuItem
                key={`${opt.value}::${opt.label}`}
                disabled={opt.disabled}
                className={cn("gap-2", opt.description && "items-start py-1.5")}
                onClick={() => {
                  if (opt.disabled || opt.value === value) return;
                  onChange(opt.value);
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{opt.label}</span>
                  {opt.description ? (
                    <span className="mt-0.5 block text-xs leading-snug text-foreground/70">
                      {opt.description}
                    </span>
                  ) : null}
                </span>
                {isCurrent ? (
                  <Icon name="check" size={14} className="mt-0.5 shrink-0 text-primary" />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
