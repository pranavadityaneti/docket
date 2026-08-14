import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { hashPassword } from "./password";
import { memberships, tenants, users } from "./schema";
import { isTenantSlug, normalizeTenantSlug } from "./slug";

export class ProvisionError extends Error {
  constructor(
    message: string,
    readonly code: "conflict" | "invalid",
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

export type ProvisionTenantInput = {
  name: string;
  slug: string;
  plan?: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
};

export type ProvisionedTenant = {
  tenant: { id: string; name: string; slug: string; plan: string };
  owner: { id: string; name: string; email: string };
  ownerCreated: boolean;
  passwordSet: boolean;
};

function pgCode(e: unknown): string {
  return e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
}

function pgConstraint(e: unknown): string {
  if (!e || typeof e !== "object") return "";
  const rec = e as { constraint?: unknown; constraint_name?: unknown };
  return String(rec.constraint ?? rec.constraint_name ?? "");
}

/**
 * Create a workspace + owner. Runs as the connection/owner role (bypasses RLS),
 * which is required: the tenant being created is what RLS would otherwise
 * scope us to.
 *
 * Re-using an existing user (same email) attaches them as owner without
 * resetting their password, matching production bootstrap.
 */
export async function provisionTenant(
  db: Db,
  input: ProvisionTenantInput,
): Promise<ProvisionedTenant> {
  const name = input.name.trim();
  if (!name) throw new ProvisionError("Workspace name is required", "invalid");

  const slug = normalizeTenantSlug(input.slug);
  if (!isTenantSlug(slug)) {
    throw new ProvisionError(
      "Slug must be 1–63 lowercase letters or digits, with hyphens in between",
      "invalid",
    );
  }

  const ownerName = input.ownerName.trim();
  if (!ownerName) throw new ProvisionError("Owner name is required", "invalid");

  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (!ownerEmail) throw new ProvisionError("Owner email is required", "invalid");

  const plan = (input.plan ?? "trial").trim().toLowerCase() || "trial";
  const passwordHash = await hashPassword(input.ownerPassword);

  try {
    return await db.transaction(async (tx) => {
      const [insertedTenant] = await tx
        .insert(tenants)
        .values({ name, slug, plan })
        .returning({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          plan: tenants.plan,
        });
      if (!insertedTenant) {
        throw new ProvisionError("A workspace with that slug already exists", "conflict");
      }

      const [insertedUser] = await tx
        .insert(users)
        .values({ email: ownerEmail, name: ownerName, passwordHash })
        .onConflictDoNothing({ target: users.email })
        .returning({ id: users.id, name: users.name, email: users.email });

      let owner = insertedUser;
      let passwordSet = Boolean(insertedUser);
      if (!owner) {
        const [existing] = await tx
          .select({
            id: users.id,
            name: users.name,
            email: users.email,
            passwordHash: users.passwordHash,
          })
          .from(users)
          .where(eq(users.email, ownerEmail))
          .limit(1);
        if (!existing) throw new ProvisionError("Failed to resolve owner after insert", "invalid");
        if (existing.passwordHash === null) {
          await tx
            .update(users)
            .set({ passwordHash, name: ownerName })
            .where(eq(users.id, existing.id));
          passwordSet = true;
          owner = { id: existing.id, name: ownerName, email: existing.email };
        } else {
          owner = { id: existing.id, name: existing.name, email: existing.email };
        }
      }

      await tx
        .insert(memberships)
        .values({ userId: owner.id, tenantId: insertedTenant.id, role: "owner" })
        .onConflictDoNothing({
          target: [memberships.userId, memberships.tenantId],
        });

      return {
        tenant: insertedTenant,
        owner,
        ownerCreated: Boolean(insertedUser),
        passwordSet,
      };
    });
  } catch (e) {
    if (e instanceof ProvisionError) throw e;
    if (pgCode(e) === "23505") {
      const constraint = pgConstraint(e);
      if (constraint.includes("tenants_slug") || constraint.includes("slug")) {
        throw new ProvisionError("A workspace with that slug already exists", "conflict");
      }
      if (constraint.includes("email")) {
        throw new ProvisionError("That email is already in use", "conflict");
      }
      throw new ProvisionError("A workspace with those details already exists", "conflict");
    }
    throw e;
  }
}
