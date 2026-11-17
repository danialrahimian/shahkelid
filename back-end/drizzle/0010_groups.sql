CREATE TABLE "plan_groups" (
	"plan_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "plan_groups_plan_id_group_id_pk" PRIMARY KEY("plan_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "group_hosts" (
	"group_id" uuid NOT NULL,
	"panel_id" uuid NOT NULL,
	"host_id" integer NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"name" text,
	"sort_order" integer,
	CONSTRAINT "group_hosts_group_id_panel_id_host_id_pk" PRIMARY KEY("group_id","panel_id","host_id")
);
--> statement-breakpoint
CREATE TABLE "group_sources" (
	"group_id" uuid NOT NULL,
	"panel_id" uuid NOT NULL,
	"panel_group_id" integer NOT NULL,
	"panel_group_name" text DEFAULT '' NOT NULL,
	"all_hosts" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "group_sources_group_id_panel_id_panel_group_id_pk" PRIMARY KEY("group_id","panel_id","panel_group_id"),
	CONSTRAINT "group_sources_panel_group_positive" CHECK ("group_sources"."panel_group_id" > 0)
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_groups" (
	"subscription_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	CONSTRAINT "subscription_groups_subscription_id_group_id_pk" PRIMARY KEY("subscription_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "plan_groups" ADD CONSTRAINT "plan_groups_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_groups" ADD CONSTRAINT "plan_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_hosts" ADD CONSTRAINT "group_hosts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_hosts" ADD CONSTRAINT "group_hosts_panel_id_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."panels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sources" ADD CONSTRAINT "group_sources_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_sources" ADD CONSTRAINT "group_sources_panel_id_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."panels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_groups" ADD CONSTRAINT "subscription_groups_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_groups" ADD CONSTRAINT "subscription_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Written by hand: what plans and servers used becomes our groups, before
-- servers, locations and plan_panel_settings go. Each panel group a plan
-- granted, or a server stood for, is one group taking all its hosts; plans
-- are sold with the groups of their panels, and live subscriptions carry
-- their plan's groups on the panels they are on.
ALTER TABLE "subscription_panels" ADD COLUMN "group_ids" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE TABLE "migrated_groups" AS
SELECT uuidv7() AS "id", p."panel_id", p."panel_group_id", pn."name" AS "panel_name",
  row_number() OVER (ORDER BY pn."name", p."panel_group_id")::integer AS "n"
FROM (
  SELECT pps."panel_id", g AS "panel_group_id" FROM "plan_panel_settings" pps, unnest(pps."group_ids") g
  UNION
  SELECT s."panel_id", s."panel_group_id" FROM "servers" s WHERE s."panel_group_id" IS NOT NULL AND s."archived_at" IS NULL
) p
JOIN "panels" pn ON pn."id" = p."panel_id"
WHERE p."panel_group_id" > 0;--> statement-breakpoint
INSERT INTO "groups" ("id", "name", "sort_order")
SELECT "id", "panel_name" || ' · ' || "panel_group_id", "n" FROM "migrated_groups";--> statement-breakpoint
INSERT INTO "group_sources" ("group_id", "panel_id", "panel_group_id", "panel_group_name", "all_hosts")
SELECT "id", "panel_id", "panel_group_id", 'group ' || "panel_group_id", true FROM "migrated_groups";--> statement-breakpoint
INSERT INTO "plan_groups" ("plan_id", "group_id")
SELECT DISTINCT pps."plan_id", mg."id"
FROM "plan_panel_settings" pps
JOIN "migrated_groups" mg ON mg."panel_id" = pps."panel_id"
WHERE mg."panel_group_id" = ANY (pps."group_ids")
  OR mg."panel_group_id" IN (
    SELECT s."panel_group_id" FROM "servers" s WHERE s."panel_id" = pps."panel_id" AND s."archived_at" IS NULL
  );--> statement-breakpoint
INSERT INTO "subscription_groups" ("subscription_id", "group_id")
SELECT DISTINCT s."id", pg."group_id"
FROM "subscriptions" s
JOIN "plan_groups" pg ON pg."plan_id" = s."plan_id"
JOIN "group_sources" gs ON gs."group_id" = pg."group_id"
JOIN "subscription_panels" m ON m."subscription_id" = s."id" AND m."panel_id" = gs."panel_id";--> statement-breakpoint
UPDATE "subscription_panels" m SET "group_ids" = coalesce((
  SELECT array_agg(DISTINCT gs."panel_group_id" ORDER BY gs."panel_group_id")
  FROM "subscription_groups" sg
  JOIN "group_sources" gs ON gs."group_id" = sg."group_id" AND gs."panel_id" = m."panel_id"
  WHERE sg."subscription_id" = m."subscription_id"
), '{}');--> statement-breakpoint
DROP TABLE "migrated_groups";--> statement-breakpoint
ALTER TABLE "plan_panel_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "locations" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "servers" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "plan_panel_settings" CASCADE;--> statement-breakpoint
DROP TABLE "locations" CASCADE;--> statement-breakpoint
DROP TABLE "servers" CASCADE;--> statement-breakpoint
ALTER TABLE "subscription_panels" DROP CONSTRAINT "subscription_panels_server_id_servers_id_fk";
--> statement-breakpoint
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_server_id_servers_id_fk";
--> statement-breakpoint
DROP INDEX "subscription_panels_server_idx";--> statement-breakpoint
DROP INDEX "subscriptions_server_idx";--> statement-breakpoint
CREATE INDEX "group_sources_panel_idx" ON "group_sources" USING btree ("panel_id");--> statement-breakpoint
CREATE INDEX "subscription_groups_group_idx" ON "subscription_groups" USING btree ("group_id");--> statement-breakpoint
ALTER TABLE "subscription_panels" DROP COLUMN "server_id";--> statement-breakpoint
ALTER TABLE "subscriptions" DROP COLUMN "server_id";--> statement-breakpoint
DROP TYPE "public"."server_status";