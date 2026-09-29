CREATE TYPE "public"."actor_kind" AS ENUM('customer', 'staff', 'reseller', 'system', 'bot');--> statement-breakpoint
CREATE TYPE "public"."order_kind" AS ENUM('new', 'renewal', 'upgrade', 'add_data', 'add_days', 'wallet_topup');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'fulfilled', 'failed', 'cancelled', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('zarinpal', 'card_transfer', 'nowpayments', 'usdt_tron', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'pending', 'pending_review', 'succeeded', 'failed', 'expired', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."transfer_match" AS ENUM('matched', 'unmatched', 'late', 'wrong_amount', 'credited_to_wallet', 'refunded', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."traffic_reset" AS ENUM('no_reset', 'daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."file_purpose" AS ENUM('receipt', 'post_cover', 'content_image', 'ticket_attachment', 'avatar');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."panel_driver" AS ENUM('pasarguard', 'marzban', 'x3ui', 'hiddify');--> statement-breakpoint
CREATE TYPE "public"."server_status" AS ENUM('online', 'degraded', 'offline', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."ledger_account_kind" AS ENUM('customer_wallet', 'reseller_credit', 'commission_balance', 'revenue', 'discounts', 'refunds', 'adjustments', 'gateway_zarinpal', 'gateway_card', 'gateway_nowpayments', 'gateway_usdt_tron');--> statement-breakpoint
CREATE TYPE "public"."ledger_tx_kind" AS ENUM('order_payment', 'wallet_topup', 'wallet_purchase', 'refund', 'commission_accrual', 'commission_payout', 'reseller_credit_topup', 'manual_adjustment');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('email', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('provisioning', 'provisioning_failed', 'on_hold', 'active', 'limited', 'expired', 'disabled', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."message_author" AS ENUM('customer', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."ticket_channel" AS ENUM('web', 'telegram', 'email');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('awaiting_staff', 'awaiting_customer', 'resolved', 'closed');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"user_agent" text,
	"request_id" text
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission"),
	CONSTRAINT "role_permissions_format" CHECK ("role_permissions"."permission" ~ '^[a-z_]+:[a-z_]+$')
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"requires_2fa" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key"),
	CONSTRAINT "roles_key_format" CHECK ("roles"."key" ~ '^[a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "card_transfer_receipts" (
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"destination_card_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"tracking_number" text NOT NULL,
	"payer_card_last4" text,
	"claimed_paid_at" timestamp with time zone,
	"image_sha256" text NOT NULL,
	"flags" text[] DEFAULT '{}' NOT NULL,
	"review_note" text DEFAULT '' NOT NULL,
	CONSTRAINT "card_transfer_receipts_last4_format" CHECK ("card_transfer_receipts"."payer_card_last4" ~ '^[0-9]{4}$')
);
--> statement-breakpoint
CREATE TABLE "crypto_invoices" (
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"asset" text DEFAULT 'USDT' NOT NULL,
	"network" text DEFAULT 'TRON' NOT NULL,
	"token_contract" text NOT NULL,
	"amount_units" bigint NOT NULL,
	"amount_received_units" bigint DEFAULT 0 NOT NULL,
	"rate_toman_per_asset" bigint NOT NULL,
	"exchange_rate_id" bigint NOT NULL,
	"pay_address" text NOT NULL,
	"processor_invoice_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "crypto_invoices_processor_invoice_id_unique" UNIQUE("processor_invoice_id"),
	CONSTRAINT "crypto_invoices_amount_positive" CHECK ("crypto_invoices"."amount_units" > 0),
	CONSTRAINT "crypto_invoices_received_not_negative" CHECK ("crypto_invoices"."amount_received_units" >= 0),
	CONSTRAINT "crypto_invoices_rate_positive" CHECK ("crypto_invoices"."rate_toman_per_asset" > 0)
);
--> statement-breakpoint
CREATE TABLE "crypto_transfers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"network" text DEFAULT 'TRON' NOT NULL,
	"token_contract" text NOT NULL,
	"tx_hash" text NOT NULL,
	"event_index" integer DEFAULT 0 NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"amount_units" bigint NOT NULL,
	"block_number" bigint NOT NULL,
	"block_time" timestamp with time zone NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"match" "transfer_match" DEFAULT 'unmatched' NOT NULL,
	"payment_id" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text DEFAULT '' NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crypto_transfers_payment_id_unique" UNIQUE("payment_id"),
	CONSTRAINT "crypto_transfers_network_tx_hash_event_index_key" UNIQUE("network","tx_hash","event_index"),
	CONSTRAINT "crypto_transfers_amount_positive" CHECK ("crypto_transfers"."amount_units" > 0),
	CONSTRAINT "crypto_transfers_matched_has_payment" CHECK (("crypto_transfers"."match" = 'matched') = ("crypto_transfers"."payment_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "exchange_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source" text DEFAULT 'nobitex' NOT NULL,
	"asset" text DEFAULT 'USDT' NOT NULL,
	"bid_toman" bigint NOT NULL,
	"ask_toman" bigint NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_bid_positive" CHECK ("exchange_rates"."bid_toman" > 0),
	CONSTRAINT "exchange_rates_ask_positive" CHECK ("exchange_rates"."ask_toman" > 0),
	CONSTRAINT "exchange_rates_bid_not_above_ask" CHECK ("exchange_rates"."bid_toman" <= "exchange_rates"."ask_toman")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "invoices_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1),
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"subtotal_toman" bigint NOT NULL,
	"discount_toman" bigint NOT NULL,
	"total_toman" bigint NOT NULL,
	"lines" jsonb NOT NULL,
	"customer_snapshot" jsonb NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number"),
	CONSTRAINT "invoices_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "invoices_total_adds_up" CHECK ("invoices"."total_toman" = "invoices"."subtotal_toman" - "invoices"."discount_toman")
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"plan_id" uuid,
	"plan_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_toman" bigint NOT NULL,
	"total_toman" bigint NOT NULL,
	CONSTRAINT "order_items_quantity_range" CHECK ("order_items"."quantity" between 1 and 1000),
	CONSTRAINT "order_items_unit_price_not_negative" CHECK ("order_items"."unit_price_toman" >= 0),
	CONSTRAINT "order_items_total_adds_up" CHECK ("order_items"."total_toman" = "order_items"."unit_price_toman" * "order_items"."quantity")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 100001 CACHE 1),
	"user_id" uuid NOT NULL,
	"placed_by_user_id" uuid,
	"kind" "order_kind" NOT NULL,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"subscription_id" uuid,
	"subtotal_toman" bigint NOT NULL,
	"discount_toman" bigint DEFAULT 0 NOT NULL,
	"total_toman" bigint NOT NULL,
	"idempotency_key" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_number_unique" UNIQUE("number"),
	CONSTRAINT "orders_user_id_idempotency_key_key" UNIQUE("user_id","idempotency_key"),
	CONSTRAINT "orders_subtotal_not_negative" CHECK ("orders"."subtotal_toman" >= 0),
	CONSTRAINT "orders_discount_not_negative" CHECK ("orders"."discount_toman" >= 0),
	CONSTRAINT "orders_total_adds_up" CHECK ("orders"."total_toman" = "orders"."subtotal_toman" - "orders"."discount_toman" and "orders"."total_toman" >= 0),
	CONSTRAINT "orders_target_subscription" CHECK ("orders"."kind" in ('new', 'wallet_topup') or "orders"."subscription_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "payment_cards" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"label" text NOT NULL,
	"bank_name" text NOT NULL,
	"card_number" text NOT NULL,
	"holder_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_cards_number_format" CHECK ("payment_cards"."card_number" ~ '^[0-9]{16}$')
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"amount_toman" bigint NOT NULL,
	"provider_reference" text,
	"provider_ref_id" text,
	"provider_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_reason" text,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"succeeded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_toman" > 0),
	CONSTRAINT "payments_success_is_timestamped" CHECK (("payments"."status" = 'succeeded') = ("payments"."succeeded_at" is not null) or "payments"."status" = 'refunded')
);
--> statement-breakpoint
CREATE TABLE "plan_panel_settings" (
	"plan_id" uuid NOT NULL,
	"panel_id" uuid NOT NULL,
	"group_ids" integer[] DEFAULT '{}' NOT NULL,
	"user_template_id" integer,
	CONSTRAINT "plan_panel_settings_plan_id_panel_id_pk" PRIMARY KEY("plan_id","panel_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"data_limit_bytes" bigint,
	"duration_days" integer NOT NULL,
	"device_limit" integer,
	"traffic_reset" "traffic_reset" DEFAULT 'no_reset' NOT NULL,
	"price_toman" bigint NOT NULL,
	"is_trial" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "plans_slug_unique" UNIQUE("slug"),
	CONSTRAINT "plans_slug_format" CHECK ("plans"."slug" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "plans_data_limit_positive" CHECK ("plans"."data_limit_bytes" is null or "plans"."data_limit_bytes" > 0),
	CONSTRAINT "plans_duration_range" CHECK ("plans"."duration_days" between 1 and 3650),
	CONSTRAINT "plans_device_limit_range" CHECK ("plans"."device_limit" is null or "plans"."device_limit" between 1 and 100),
	CONSTRAINT "plans_price_not_negative" CHECK ("plans"."price_toman" >= 0),
	CONSTRAINT "plans_trial_is_free" CHECK (not "plans"."is_trial" or "plans"."price_toman" = 0)
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"post_id" uuid NOT NULL,
	"user_id" uuid,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_comments_body_length" CHECK (char_length("post_comments"."body") between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "post_likes" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_likes_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"translation_group_id" uuid DEFAULT uuidv7() NOT NULL,
	"locale" text DEFAULT 'fa' NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"excerpt" text NOT NULL,
	"body" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"cover_file_id" uuid,
	"author_user_id" uuid,
	"author_name" text NOT NULL,
	"status" "content_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"seo_title" text,
	"seo_description" text,
	"like_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posts_locale_slug_key" UNIQUE("locale","slug"),
	CONSTRAINT "posts_translation_group_id_locale_key" UNIQUE("translation_group_id","locale"),
	CONSTRAINT "posts_locale" CHECK ("posts"."locale" in ('fa', 'en')),
	CONSTRAINT "posts_title_length" CHECK (char_length("posts"."title") between 3 and 160),
	CONSTRAINT "posts_excerpt_length" CHECK (char_length("posts"."excerpt") between 10 and 300),
	CONSTRAINT "posts_like_count_not_negative" CHECK ("posts"."like_count" >= 0),
	CONSTRAINT "posts_comment_count_not_negative" CHECK ("posts"."comment_count" >= 0),
	CONSTRAINT "posts_published_has_date" CHECK ("posts"."status" <> 'published' or "posts"."published_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "customer_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_notes_body_length" CHECK (char_length("customer_notes"."body") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"stage_override" text,
	"owner_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_stage" CHECK ("customer_profiles"."stage_override" in ('lead', 'active', 'at-risk', 'churned', 'vip', 'blocked'))
);
--> statement-breakpoint
CREATE TABLE "customer_tags" (
	"user_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_tags_user_id_tag_id_pk" PRIMARY KEY("user_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" "citext" NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tags_name_unique" UNIQUE("name"),
	CONSTRAINT "tags_name_length" CHECK (char_length("tags"."name") <= 40)
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"storage_key" text NOT NULL,
	"purpose" "file_purpose" NOT NULL,
	"original_name" text DEFAULT '' NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "files_size_positive" CHECK ("files"."size_bytes" > 0),
	CONSTRAINT "files_sha256_format" CHECK ("files"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "user_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" "citext" NOT NULL,
	"email_normalized" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"password_hash" text,
	"display_name" text DEFAULT '' NOT NULL,
	"locale" text DEFAULT 'fa' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"avatar_file_id" uuid,
	"telegram_user_id" bigint,
	"telegram_username" text,
	"referral_code" text NOT NULL,
	"referred_by_user_id" uuid,
	"totp_secret_enc" "bytea",
	"totp_enabled_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_telegram_user_id_unique" UNIQUE("telegram_user_id"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code"),
	CONSTRAINT "users_display_name_length" CHECK (char_length("users"."display_name") <= 80),
	CONSTRAINT "users_locale" CHECK ("users"."locale" in ('fa', 'en')),
	CONSTRAINT "users_not_self_referred" CHECK ("users"."referred_by_user_id" is null or "users"."referred_by_user_id" <> "users"."id")
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"code" text NOT NULL,
	"name_fa" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "locations_code_unique" UNIQUE("code"),
	CONSTRAINT "locations_code_format" CHECK ("locations"."code" ~ '^[A-Z]{2}(-[A-Z0-9]+)?$')
);
--> statement-breakpoint
CREATE TABLE "panels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"driver" "panel_driver" NOT NULL,
	"base_url" text NOT NULL,
	"credentials_enc" "bytea" NOT NULL,
	"subscription_base_url" text,
	"version" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "servers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"panel_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"host" text NOT NULL,
	"panel_node_id" integer,
	"panel_group_id" integer,
	"capacity_users" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"accepting_new" boolean DEFAULT true NOT NULL,
	"status" "server_status" DEFAULT 'online' NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "servers_capacity_positive" CHECK ("servers"."capacity_users" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" "ledger_account_kind" NOT NULL,
	"user_id" uuid,
	"balance_toman" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_kind_user_id_key" UNIQUE NULLS NOT DISTINCT("kind","user_id"),
	CONSTRAINT "ledger_accounts_owner" CHECK (("ledger_accounts"."kind" in ('customer_wallet', 'reseller_credit', 'commission_balance')) = ("ledger_accounts"."user_id" is not null)),
	CONSTRAINT "ledger_accounts_user_balance_not_negative" CHECK ("ledger_accounts"."kind" not in ('customer_wallet', 'reseller_credit', 'commission_balance') or "ledger_accounts"."balance_toman" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_toman" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_not_zero" CHECK ("ledger_entries"."amount_toman" <> 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" "ledger_tx_kind" NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"memo" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"locale" text DEFAULT 'fa' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"body" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_key_channel_locale_key" UNIQUE("key","channel","locale"),
	CONSTRAINT "notification_templates_locale" CHECK ("notification_templates"."locale" in ('fa', 'en'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid,
	"channel" "notification_channel" NOT NULL,
	"template_key" text NOT NULL,
	"recipient" text NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscription_alerts_sent" (
	"subscription_id" uuid NOT NULL,
	"alert" text NOT NULL,
	"cycle_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_alerts_sent_subscription_id_alert_cycle_key_pk" PRIMARY KEY("subscription_id","alert","cycle_key"),
	CONSTRAINT "subscription_alerts_sent_alert" CHECK ("subscription_alerts_sent"."alert" in ('expiry_3d', 'expiry_1d', 'usage_80', 'usage_100'))
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "subscription_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"subscription_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_user_id" uuid,
	"order_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"reseller_user_id" uuid,
	"plan_id" uuid NOT NULL,
	"panel_id" uuid NOT NULL,
	"server_id" uuid,
	"panel_username" text NOT NULL,
	"panel_user_id" integer,
	"status" "subscription_status" DEFAULT 'provisioning' NOT NULL,
	"is_trial" boolean DEFAULT false NOT NULL,
	"data_limit_bytes" bigint,
	"device_limit" integer,
	"expires_at" timestamp with time zone,
	"starts_on_first_use" boolean DEFAULT false NOT NULL,
	"used_bytes" bigint DEFAULT 0 NOT NULL,
	"lifetime_used_bytes" bigint DEFAULT 0 NOT NULL,
	"online_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"access_token" text NOT NULL,
	"panel_subscription_url" text,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"provisioned_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_access_token_unique" UNIQUE("access_token"),
	CONSTRAINT "subscriptions_panel_username_key" UNIQUE("panel_id","panel_username"),
	CONSTRAINT "subscriptions_panel_user_id_key" UNIQUE("panel_id","panel_user_id"),
	CONSTRAINT "subscriptions_data_limit_positive" CHECK ("subscriptions"."data_limit_bytes" is null or "subscriptions"."data_limit_bytes" > 0),
	CONSTRAINT "subscriptions_used_not_negative" CHECK ("subscriptions"."used_bytes" >= 0),
	CONSTRAINT "subscriptions_lifetime_not_negative" CHECK ("subscriptions"."lifetime_used_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ticket_categories" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name_fa" text NOT NULL,
	"name_en" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_message_files" (
	"message_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	CONSTRAINT "ticket_message_files_message_id_file_id_pk" PRIMARY KEY("message_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"author_user_id" uuid,
	"author_kind" "message_author" NOT NULL,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_messages_body_length" CHECK (char_length("ticket_messages"."body") between 1 and 10000),
	CONSTRAINT "ticket_messages_internal_is_staff" CHECK (not "ticket_messages"."is_internal" or "ticket_messages"."author_kind" = 'staff')
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" bigint GENERATED ALWAYS AS IDENTITY (sequence name "tickets_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1001 CACHE 1),
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"category_id" uuid,
	"subject" text NOT NULL,
	"status" "ticket_status" DEFAULT 'awaiting_staff' NOT NULL,
	"priority" "ticket_priority" DEFAULT 'normal' NOT NULL,
	"channel" "ticket_channel" DEFAULT 'web' NOT NULL,
	"assigned_to_user_id" uuid,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_number_unique" UNIQUE("number"),
	CONSTRAINT "tickets_subject_length" CHECK (char_length("tickets"."subject") between 3 and 160)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"topic" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "site_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transfer_receipts" ADD CONSTRAINT "card_transfer_receipts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transfer_receipts" ADD CONSTRAINT "card_transfer_receipts_destination_card_id_payment_cards_id_fk" FOREIGN KEY ("destination_card_id") REFERENCES "public"."payment_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_transfer_receipts" ADD CONSTRAINT "card_transfer_receipts_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_invoices" ADD CONSTRAINT "crypto_invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_invoices" ADD CONSTRAINT "crypto_invoices_exchange_rate_id_exchange_rates_id_fk" FOREIGN KEY ("exchange_rate_id") REFERENCES "public"."exchange_rates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_transfers" ADD CONSTRAINT "crypto_transfers_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crypto_transfers" ADD CONSTRAINT "crypto_transfers_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_placed_by_user_id_users_id_fk" FOREIGN KEY ("placed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_panel_settings" ADD CONSTRAINT "plan_panel_settings_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_panel_settings" ADD CONSTRAINT "plan_panel_settings_panel_id_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."panels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_likes" ADD CONSTRAINT "post_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_cover_file_id_files_id_fk" FOREIGN KEY ("cover_file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_recovery_codes" ADD CONSTRAINT "user_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_file_id_files_id_fk" FOREIGN KEY ("avatar_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_user_id_users_id_fk" FOREIGN KEY ("referred_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_panel_id_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."panels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "servers" ADD CONSTRAINT "servers_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_transactions" ADD CONSTRAINT "ledger_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_alerts_sent" ADD CONSTRAINT "subscription_alerts_sent_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_reseller_user_id_users_id_fk" FOREIGN KEY ("reseller_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_panel_id_panels_id_fk" FOREIGN KEY ("panel_id") REFERENCES "public"."panels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_server_id_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_message_files" ADD CONSTRAINT "ticket_message_files_message_id_ticket_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ticket_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_message_files" ADD CONSTRAINT "ticket_message_files_file_id_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."files"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_category_id_ticket_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."ticket_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_settings" ADD CONSTRAINT "site_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id","occurred_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "audit_logs_time_idx" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "card_transfer_receipts_image_idx" ON "card_transfer_receipts" USING btree ("image_sha256");--> statement-breakpoint
CREATE INDEX "card_transfer_receipts_tracking_idx" ON "card_transfer_receipts" USING btree ("tracking_number");--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_invoices_open_amount_idx" ON "crypto_invoices" USING btree ("network","pay_address","amount_units") WHERE "crypto_invoices"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "crypto_invoices_open_idx" ON "crypto_invoices" USING btree ("expires_at") WHERE "crypto_invoices"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "crypto_transfers_review_idx" ON "crypto_transfers" USING btree ("seen_at") WHERE "crypto_transfers"."match" in ('unmatched', 'late', 'wrong_amount');--> statement-breakpoint
CREATE INDEX "crypto_transfers_block_idx" ON "crypto_transfers" USING btree ("network","block_number" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "exchange_rates_latest_idx" ON "exchange_rates" USING btree ("asset","fetched_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "invoices_user_idx" ON "invoices" USING btree ("user_id","issued_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_items_plan_idx" ON "order_items" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "orders_subscription_idx" ON "orders" USING btree ("subscription_id") WHERE "orders"."subscription_id" is not null;--> statement-breakpoint
CREATE INDEX "orders_pending_idx" ON "orders" USING btree ("expires_at") WHERE "orders"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "orders_paid_at_idx" ON "orders" USING btree ("paid_at") WHERE "orders"."paid_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_idx" ON "payments" USING btree ("method","provider_reference") WHERE "payments"."provider_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_one_success_idx" ON "payments" USING btree ("order_id") WHERE "payments"."status" = 'succeeded';--> statement-breakpoint
CREATE INDEX "payments_open_idx" ON "payments" USING btree ("status","created_at") WHERE "payments"."status" in ('initiated', 'pending', 'pending_review');--> statement-breakpoint
CREATE INDEX "payments_user_idx" ON "payments" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE UNIQUE INDEX "plans_single_trial_idx" ON "plans" USING btree ("is_trial") WHERE "plans"."is_trial" and "plans"."is_active" and "plans"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "post_comments_post_idx" ON "post_comments" USING btree ("post_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "posts_published_idx" ON "posts" USING btree ("locale","published_at" DESC NULLS FIRST) WHERE "posts"."status" = 'published';--> statement-breakpoint
CREATE INDEX "posts_tags_idx" ON "posts" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "customer_notes_user_idx" ON "customer_notes" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "customer_tags_tag_idx" ON "customer_tags" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "files_sha256_idx" ON "files" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "user_recovery_codes_user_idx" ON "user_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_normalized_idx" ON "users" USING btree ("email_normalized");--> statement-breakpoint
CREATE INDEX "users_referred_by_idx" ON "users" USING btree ("referred_by_user_id") WHERE "users"."referred_by_user_id" is not null;--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "servers_panel_idx" ON "servers" USING btree ("panel_id");--> statement-breakpoint
CREATE INDEX "servers_placement_idx" ON "servers" USING btree ("priority" DESC NULLS FIRST) WHERE "servers"."accepting_new" and "servers"."status" = 'online' and "servers"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id","id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_transactions_ref_idx" ON "ledger_transactions" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "notifications_queued_idx" ON "notifications" USING btree ("created_at") WHERE "notifications"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "subscription_events_idx" ON "subscription_events" USING btree ("subscription_id","id" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "subscriptions_reseller_idx" ON "subscriptions" USING btree ("reseller_user_id") WHERE "subscriptions"."reseller_user_id" is not null;--> statement-breakpoint
CREATE INDEX "subscriptions_expiry_idx" ON "subscriptions" USING btree ("expires_at") WHERE "subscriptions"."status" in ('active', 'on_hold', 'limited');--> statement-breakpoint
CREATE INDEX "subscriptions_server_idx" ON "subscriptions" USING btree ("server_id") WHERE "subscriptions"."status" in ('provisioning', 'on_hold', 'active', 'limited');--> statement-breakpoint
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" USING btree ("status") WHERE "subscriptions"."status" in ('provisioning', 'provisioning_failed');--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "tickets_queue_idx" ON "tickets" USING btree ("priority","last_message_at") WHERE "tickets"."status" = 'awaiting_staff';--> statement-breakpoint
CREATE INDEX "tickets_assignee_idx" ON "tickets" USING btree ("assigned_to_user_id","status") WHERE "tickets"."assigned_to_user_id" is not null;--> statement-breakpoint
CREATE INDEX "tickets_user_idx" ON "tickets" USING btree ("user_id","created_at" DESC NULLS FIRST);--> statement-breakpoint
CREATE INDEX "outbox_unpublished_idx" ON "outbox_events" USING btree ("id") WHERE "outbox_events"."published_at" is null;