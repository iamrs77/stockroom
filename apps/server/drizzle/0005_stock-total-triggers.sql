-- products.total_stock is the sum of the product's rows in stock_levels. These triggers keep it in
-- step inside the same transaction as every change, whichever code path makes the change.
--
-- They're statement-level triggers with transition tables: each statement's changes are added up
-- per product and applied with one UPDATE. An import chunk that touches 3,000 stock rows fires each
-- trigger once, not 3,000 times. Writers already hold the product rows' locks (the lock order is
-- products, then stock levels), so these updates add no new lock ordering.
--
-- A trigger with transition tables can only handle one kind of event, hence three of them.

CREATE FUNCTION stock_levels_total_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products p
  SET total_stock = p.total_stock + d.delta
  FROM (SELECT product_id, sum(quantity)::int AS delta FROM inserted GROUP BY product_id) d
  WHERE p.id = d.product_id AND d.delta <> 0;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE FUNCTION stock_levels_total_after_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products p
  SET total_stock = p.total_stock + d.delta
  FROM (
    SELECT n.product_id, sum(n.quantity - o.quantity)::int AS delta
    FROM updated_new n
    JOIN updated_old o ON o.product_id = n.product_id AND o.store_id = n.store_id
    GROUP BY n.product_id
  ) d
  WHERE p.id = d.product_id AND d.delta <> 0;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE FUNCTION stock_levels_total_after_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- When a product is deleted, its stock rows cascade; its own row is already gone, so this
  -- UPDATE simply matches nothing for it.
  UPDATE products p
  SET total_stock = p.total_stock - d.removed
  FROM (SELECT product_id, sum(quantity)::int AS removed FROM deleted GROUP BY product_id) d
  WHERE p.id = d.product_id AND d.removed <> 0;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE TRIGGER stock_levels_total_insert AFTER INSERT ON stock_levels
  REFERENCING NEW TABLE AS inserted
  FOR EACH STATEMENT EXECUTE FUNCTION stock_levels_total_after_insert();
--> statement-breakpoint

CREATE TRIGGER stock_levels_total_update AFTER UPDATE ON stock_levels
  REFERENCING OLD TABLE AS updated_old NEW TABLE AS updated_new
  FOR EACH STATEMENT EXECUTE FUNCTION stock_levels_total_after_update();
--> statement-breakpoint

CREATE TRIGGER stock_levels_total_delete AFTER DELETE ON stock_levels
  REFERENCING OLD TABLE AS deleted
  FOR EACH STATEMENT EXECUTE FUNCTION stock_levels_total_after_delete();
--> statement-breakpoint

-- Backfill existing products.
UPDATE products p
SET total_stock = s.total
FROM (SELECT product_id, sum(quantity)::int AS total FROM stock_levels GROUP BY product_id) s
WHERE p.id = s.product_id AND p.total_stock <> s.total;
