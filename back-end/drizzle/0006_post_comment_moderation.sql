CREATE TYPE "public"."comment_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
ALTER TABLE "post_comments" ADD COLUMN "status" "comment_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_comments" ADD COLUMN "moderated_by" uuid;--> statement-breakpoint
ALTER TABLE "post_comments" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_comments_pending_idx" ON "post_comments" USING btree ("created_at") WHERE "post_comments"."status" = 'pending';