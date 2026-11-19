DROP INDEX "products_tenant_name_idx";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "total_stock" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "search_text" text GENERATED ALWAYS AS (lower(name || ' ' || sku || ' ' || coalesce(category, ''))) STORED;--> statement-breakpoint
CREATE INDEX "products_active_name_idx" ON "products" USING btree ("tenant_id","name","id") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "products_active_stock_idx" ON "products" USING btree ("tenant_id","total_stock","id") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "products_active_price_idx" ON "products" USING btree ("tenant_id","price_cents","id") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "products_active_updated_idx" ON "products" USING btree ("tenant_id","updated_at","id") WHERE archived_at is null;--> statement-breakpoint
CREATE INDEX "products_low_stock_idx" ON "products" USING btree ("tenant_id","total_stock","id") WHERE archived_at is null and reorder_point > 0 and total_stock <= reorder_point;--> statement-breakpoint
CREATE INDEX "products_search_trgm_idx" ON "products" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_total_stock_nonnegative" CHECK ("products"."total_stock" >= 0);