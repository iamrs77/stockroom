-- The first version of this function joined the old and new transition tables on (product, store).
-- Transition tables have no indexes or statistics, so Postgres compared every old row with every new
-- one: 16 million comparisons for a 4,000-row import chunk, about 140 ms each time.
--
-- The join isn't needed: a product's change is the sum of its new quantities minus the sum of its
-- old ones. Stacking both sets and grouping once is linear in the number of rows.
CREATE OR REPLACE FUNCTION stock_levels_total_after_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products p
  SET total_stock = p.total_stock + d.delta
  FROM (
    SELECT product_id, sum(change)::int AS delta
    FROM (
      SELECT product_id, quantity AS change FROM updated_new
      UNION ALL
      SELECT product_id, -quantity FROM updated_old
    ) changes
    GROUP BY product_id
  ) d
  WHERE p.id = d.product_id AND d.delta <> 0;
  RETURN NULL;
END $$;
