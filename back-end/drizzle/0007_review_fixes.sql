ALTER TABLE "users" ADD COLUMN "sessions_revoked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "crypto_invoices_amount_idx" ON "crypto_invoices" USING btree ("pay_address","amount_units");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "ticket_message_files_file_idx" ON "ticket_message_files" USING btree ("file_id");