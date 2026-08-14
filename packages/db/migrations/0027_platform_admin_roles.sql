-- Console operator roles. Existing rows are the bootstrap super-admin.
ALTER TABLE "platform_admins" ADD COLUMN "role" text DEFAULT 'super_admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_role_check" CHECK ("role" IN ('super_admin', 'admin', 'sub_admin'));
