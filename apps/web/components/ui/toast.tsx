"use client";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import * as React from "react";

export type ToastTone = "default" | "danger" | "info";

export type ToastInput = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Auto-dismiss ms. Default 4.5s. */
  durationMs?: number;
};

type ToastItem = ToastInput & { id: number };

type ToastApi = {
  push: (toast: ToastInput) => void;
};

const ToastContext = React.createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  const push = React.useCallback((toast: ToastInput) => {
    const id = nextId++;
    const durationMs = toast.durationMs ?? 4500;
    setItems((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, durationMs);
  }, []);

  const api = React.useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed right-3 top-3 z-[100] flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-[12px] border bg-background px-3 py-2.5 shadow-lg",
              t.tone === "danger" && "border-danger-border bg-danger-muted",
              t.tone === "info" && "border-sky-border bg-sky-muted",
            )}
          >
            <div className="flex items-start gap-2">
              <Icon
                name={t.tone === "danger" ? "delete" : "info"}
                size={16}
                className={cn(
                  "mt-0.5 shrink-0",
                  t.tone === "danger"
                    ? "text-danger"
                    : t.tone === "info"
                      ? "text-sky-700 dark:text-sky-300"
                      : "text-muted-foreground",
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t.title}</div>
                {t.description ? (
                  <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
                ) : null}
              </div>
              <button
                type="button"
                className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Dismiss"
                onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => {
        // No provider (tests / early render) - no-op.
      },
    };
  }
  return ctx;
}
