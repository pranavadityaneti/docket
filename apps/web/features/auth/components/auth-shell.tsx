"use client";

import { DocketWatermark } from "@/components/brand/docket-mark";
import { fetchPublicWorkspace, publicWorkspaceLogoUrl, type PublicWorkspace } from "@/features/auth/api";
import { resolveWorkspaceSlug } from "@/lib/tenant-host";
import Link from "next/link";
import * as React from "react";

export type AuthWorkspaceState = {
  slug: string | null;
  tenant: PublicWorkspace | null;
  status: "idle" | "loading" | "ready" | "missing";
};

const AuthWorkspaceContext = React.createContext<AuthWorkspaceState>({
  slug: null,
  tenant: null,
  status: "idle",
});

export function useAuthWorkspace(): AuthWorkspaceState {
  return React.useContext(AuthWorkspaceContext);
}

function useResolvedWorkspace(enabled: boolean): AuthWorkspaceState {
  const [state, setState] = React.useState<AuthWorkspaceState>({
    slug: null,
    tenant: null,
    status: enabled ? "idle" : "ready",
  });

  React.useEffect(() => {
    if (!enabled) return;
    const slug = resolveWorkspaceSlug();
    if (!slug) {
      setState({ slug: null, tenant: null, status: "ready" });
      return;
    }
    let cancelled = false;
    setState({ slug, tenant: null, status: "loading" });
    void fetchPublicWorkspace(slug)
      .then((tenant) => {
        if (!cancelled) setState({ slug, tenant, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setState({ slug, tenant: null, status: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
}

function BrandMark({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl?: string | null;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || "D";
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt=""
        className="size-10 rounded-xl bg-muted object-contain"
      />
    );
  }
  return (
    <span className="flex size-10 items-center justify-center rounded-xl bg-foreground text-sm font-semibold text-background">
      {initial}
    </span>
  );
}

/**
 * Shared chrome for sign-in / forgot / reset - soft pastel wash + white card,
 * flat (no elevation), reference-aligned.
 */
export function AuthShell({
  children,
  footer,
  brandHref = "/login",
  kicker = "by Finlot",
  headline = (
    <>
      Every case.
      <br />
      Every channel.
      <br />
      One place.
    </>
  ),
  pitch = "WhatsApp, email and uploads land on the same file - so your team works the case, not the inbox.",
  chips = [
    { tone: "mint" as const, title: "Collect", body: "Docs in without a portal" },
    { tone: "peach" as const, title: "Match", body: "Straight onto the case" },
    { tone: "lilac" as const, title: "Follow up", body: "Nudges that know the gap" },
  ],
  asideFooter = "Built for lenders, colleges and practices that live on documents.",
  resolveTenant = true,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
  brandHref?: string;
  kicker?: string;
  headline?: React.ReactNode;
  pitch?: string;
  chips?: { tone: "mint" | "peach" | "lilac"; title: string; body: string }[];
  asideFooter?: string;
  /** Tenant login pages load name/logo from the host or ?workspace= slug. */
  resolveTenant?: boolean;
}) {
  const workspace = useResolvedWorkspace(resolveTenant);
  const logoUrl = workspace.tenant ? publicWorkspaceLogoUrl(workspace.tenant) : null;
  const brandName = workspace.tenant?.name ?? "Docket";
  const brandKicker = workspace.tenant
    ? workspace.tenant.slug
    : workspace.slug && workspace.status === "missing"
      ? workspace.slug
      : kicker;

  const chipClass: Record<(typeof chips)[number]["tone"], string> = {
    mint: "rounded-[10px] bg-pastel-mint px-3 py-3 text-pastel-mint-fg",
    peach: "rounded-[10px] bg-pastel-peach px-3 py-3 text-pastel-peach-fg",
    lilac: "rounded-[10px] bg-pastel-lilac px-3 py-3 text-pastel-lilac-fg",
  };

  return (
    <AuthWorkspaceContext.Provider value={workspace}>
      <div className="auth-atmosphere grid min-h-svh lg:grid-cols-[1fr_1fr]">
        <aside className="relative hidden flex-col justify-between p-10 lg:flex xl:p-14">
          <Link href={brandHref} className="animate-fade-up flex items-center gap-3">
            <BrandMark name={brandName} logoUrl={logoUrl} />
            <span className="grid leading-tight">
              <span className="text-lg font-semibold tracking-tight">{brandName}</span>
              <span className="text-xs text-muted-foreground">{brandKicker}</span>
            </span>
          </Link>

          <div className="relative z-10 max-w-md space-y-4">
            <h1 className="animate-fade-up-delay-1 text-4xl font-semibold tracking-tight text-balance xl:text-[2.75rem] xl:leading-tight">
              {headline}
            </h1>
            <p className="animate-fade-up-delay-2 text-base leading-relaxed text-muted-foreground">
              {pitch}
            </p>
            <div className="animate-fade-up-delay-2 grid gap-3 pt-2 sm:grid-cols-3">
              {chips.map((chip) => (
                <div key={chip.title} className={chipClass[chip.tone]}>
                  <div className="text-xs font-semibold">{chip.title}</div>
                  <p className="mt-1 text-xs opacity-80">{chip.body}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{asideFooter}</p>
        </aside>

        <main className="relative flex flex-col justify-center px-5 py-10 sm:px-8 lg:px-12 xl:px-16">
          <div className="mx-auto w-full max-w-[400px]">
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <BrandMark name={brandName} logoUrl={logoUrl} />
              <div className="grid leading-tight">
                <span className="text-lg font-semibold tracking-tight">{brandName}</span>
                <span className="text-xs text-muted-foreground">{brandKicker}</span>
              </div>
            </div>

            <div className="animate-fade-up overflow-hidden rounded-2xl bg-card">
              {children}
              <div className="flex justify-center border-t border-border/70 px-6 py-2.5">
                {footer ?? <DocketWatermark />}
              </div>
            </div>
          </div>
        </main>
      </div>
    </AuthWorkspaceContext.Provider>
  );
}

export function AuthCardHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 px-6 py-7">
      <div className="flex size-10 items-center justify-center rounded-xl bg-muted text-foreground">
        {icon}
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}
