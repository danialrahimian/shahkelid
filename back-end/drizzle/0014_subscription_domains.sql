CREATE TABLE "subscription_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_domains_one_primary" ON "subscription_domains" USING btree ("is_primary") WHERE "subscription_domains"."is_primary";