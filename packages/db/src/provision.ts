import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { hashPassword } from "./password";
import { postgresErrorInfo } from "./pg-error";
import { withUniquePublicId } from "./public-id";
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
  tenant: { id: string; publicId: string; name: string; slug: string; plan: string };
  owner: { id: string; loginId: string; name: string; email: string };
  ownerCreated: boolean;
  passwordSet: boolean;
};

function isPublicIdTaken(error: unknown, column: "public_id" | "login_id"): boolean {
  const pg = postgresErrorInfo(error);
  return pg?.code === "23505" && pg.constraint.includes(column);
}

/**
 * Create a workspace + owner. Runs as the connection/owner role (bypasses RLS),
 * which is required: the tenant being created is what RLS would otherwise
 * scope us to.
 *
 * Tenant ID (`DPT-…`) and User ID (`DPU-…`) are server-issued. Re-using an
 * existing user (same email) attaches them as owner without resetting their
 * password, matching production bootstrap.
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
      const insertedTenant = await withUniquePublicId(
        "tenant",
        async (publicId) => {
          const [row] = await tx
            .insert(tenants)
            .values({ name, slug, plan, publicId })
            .returning({
              id: tenants.id,
              publicId: tenants.publicId,
              name: tenants.name,
              slug: tenants.slug,
              plan: tenants.plan,
            });
          if (!row) {
            throw new ProvisionError("A workspace with that slug already exists", "conflict");
          }
          return row;
        },
        (error) => isPublicIdTaken(error, "public_id"),
      );

      const [byEmail] = await tx
        .select({
          id: users.id,
          loginId: users.loginId,
          name: users.name,
          email: users.email,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(eq(users.email, ownerEmail))
        .limit(1);

      let owner: { id: string; loginId: string; name: string; email: string };
      let ownerCreated = false;
      let passwordSet = false;

      if (byEmail) {
        if (byEmail.passwordHash === null) {
          await tx
            .update(users)
            .set({ passwordHash, name: ownerName })
            .where(eq(users.id, byEmail.id));
          passwordSet = true;
          owner = {
            id: byEmail.id,
            loginId: byEmail.loginId,
            name: ownerName,
            email: byEmail.email,
          };
        } else {
          owner = {
            id: byEmail.id,
            loginId: byEmail.loginId,
            name: byEmail.name,
            email: byEmail.email,
          };
        }
      } else {
        owner = await withUniquePublicId(
          "user",
          async (loginId) => {
            const [created] = await tx
              .insert(users)
              .values({
                loginId,
                email: ownerEmail,
                name: ownerName,
                passwordHash,
              })
              .returning({
                id: users.id,
                loginId: users.loginId,
                name: users.name,
                email: users.email,
              });
            if (!created) throw new ProvisionError("Failed to create owner", "invalid");
            return created;
          },
          (error) => isPublicIdTaken(error, "login_id"),
        );
        ownerCreated = true;
        passwordSet = true;
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
        ownerCreated,
        passwordSet,
      };
    });
  } catch (e) {
    if (e instanceof ProvisionError) throw e;
    const pg = postgresErrorInfo(e);
    if (pg?.code === "23505") {
      if (pg.constraint.includes("tenants_slug") || pg.constraint.includes("slug")) {
        throw new ProvisionError("A workspace with that slug already exists", "conflict");
      }
      if (pg.constraint.includes("login_id")) {
        throw new ProvisionError("That user ID is already in use", "conflict");
      }
      if (pg.constraint.includes("email")) {
        throw new ProvisionError("That email is already in use", "conflict");
      }
      throw new ProvisionError("A workspace with those details already exists", "conflict");
    }
    throw e;
  }
}

