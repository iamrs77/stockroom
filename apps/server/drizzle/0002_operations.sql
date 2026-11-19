CREATE TYPE "public"."transfer_status" AS ENUM('in_transit', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "low_stock_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"stock_at_open" integer NOT NULL,
	"reorder_point_at_open" integer NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"stock_at_resolve" integer
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "outbox_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "transfer_lines" (
	"transfer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"received_quantity" integer,
	CONSTRAINT "transfer_lines_transfer_id_product_id_pk" PRIMARY KEY("transfer_id","product_id"),
	CONSTRAINT "transfer_lines_quantity_positive" CHECK ("transfer_lines"."quantity" > 0),
	CONSTRAINT "transfer_lines_received_in_range" CHECK ("transfer_lines"."received_quantity" is null or ("transfer_lines"."received_quantity" >= 0 and "transfer_lines"."received_quantity" <= "transfer_lines"."quantity"))
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"from_store_id" uuid NOT NULL,
	"to_store_id" uuid NOT NULL,
	"status" "transfer_status" DEFAULT 'in_transit' NOT NULL,
	"note" text,
	"created_by" uuid,
	"received_by" uuid,
	"cancelled_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "transfers_different_stores" CHECK ("transfers"."from_store_id" <> "transfers"."to_store_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_status_code" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret" text NOT NULL,
	"event_types" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_movements" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "transfer_sequence" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deactivated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "low_stock_alerts" ADD CONSTRAINT "low_stock_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "low_stock_alerts" ADD CONSTRAINT "low_stock_alerts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_store_id_stores_id_fk" FOREIGN KEY ("from_store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_store_id_stores_id_fk" FOREIGN KEY ("to_store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_event_id_outbox_events_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox_events"("event_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invites_tenant_idx" ON "invites" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "low_stock_alerts_one_open_key" ON "low_stock_alerts" USING btree ("product_id") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "low_stock_alerts_tenant_open_idx" ON "low_stock_alerts" USING btree ("tenant_id","opened_at") WHERE resolved_at is null;--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("id") WHERE published_at is null;--> statement-breakpoint
CREATE INDEX "outbox_events_published_idx" ON "outbox_events" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "transfer_lines_product_idx" ON "transfer_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_tenant_number_key" ON "transfers" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "transfers_tenant_created_idx" ON "transfers" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_event_key" ON "webhook_deliveries" USING btree ("endpoint_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_endpoint_created_idx" ON "webhook_deliveries" USING btree ("endpoint_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_pending_idx" ON "webhook_deliveries" USING btree ("updated_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_endpoints_tenant_idx" ON "webhook_endpoints" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE set null ON UPDATE no action;