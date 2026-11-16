CREATE TABLE "subscription_panels" (
	"subscription_id" uuid NOT NULL,
	"panel_id" uuid NOT NULL,
	"server_id" uuid,
	"panel_user_id" integer,
	"panel_subscription_url" text,
	"panel_status" text,
	"data_limit_bytes" bigint,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"lifetime_used_bytes" bigint DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"on_hold_duration_seconds" integer,
	"online_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_panels_subscription_id_panel_id_pk" PRIMARY KEY("subscription_id","panel_id"),
	CONSTRAINT "subscription_panels_used_not_negative" CHECK ("subscription_panels"."used_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "subscription_panels" ADD CONSTRAINT "subscription_panels_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_panels" ADD CONSTRAINT "subscription_panels_panel_id_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."panels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_panels" ADD CONSTRAINT "subscription_panels_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_panels_panel_idx" ON "subscription_panels" USING btree ("panel_id");--> statement-breakpoint
CREATE INDEX "subscription_panels_server_idx" ON "subscription_panels" USING btree ("server_id");--> statement-breakpoint
-- Written by hand: every subscription there is so far is on one panel. Its
-- panel user becomes that panel's row here.
INSERT INTO "subscription_panels" (
  "subscription_id", "panel_id", "server_id", "panel_user_id", "panel_subscription_url", "panel_status",
  "data_limit_bytes", "used_bytes", "lifetime_used_bytes", "expires_at", "on_hold_duration_seconds",
  "online_at", "last_synced_at", "last_error"
)
SELECT s."id", s."panel_id", s."server_id", s."panel_user_id", s."panel_subscription_url",
  CASE WHEN s."panel_user_id" IS NULL OR s."status" IN ('provisioning', 'provisioning_failed', 'deleted') THEN NULL ELSE s."status"::text END,
  s."data_limit_bytes", s."used_bytes", s."lifetime_used_bytes", s."expires_at", s."on_hold_duration_seconds",
  s."online_at", s."last_synced_at",
  CASE WHEN s."status" IN ('provisioning', 'provisioning_failed') THEN NULL ELSE s."last_error" END
FROM "subscriptions" s;
