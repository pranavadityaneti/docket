-- Application DB role. The API connects as a login role that SET LOCAL ROLEs to
-- this NON-owner role per request (see withTenant), so RLS applies to all tenant
-- data. Auth/user lookups use the connection role directly (no SET ROLE).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'docket_app') THEN
    CREATE ROLE docket_app NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO docket_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO docket_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO docket_app;
