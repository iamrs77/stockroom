DROP INDEX "products_low_stock_idx";--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "low_stock" boolean GENERATED ALWAYS AS (reorder_point > 0 and total_stock <= reorder_point) STORED;--> statement-breakpoint
CREATE INDEX "products_low_stock_idx" ON "products" USING btree ("tenant_id","name","id") WHERE archived_at is null and low_stock;--> statement-breakpoint
-- The backfill in 0005 and these new columns rewrote every product row; refresh the planner's
-- statistics now rather than waiting for autovacuum, so the new indexes are used straight away.
ANALYZE products;
