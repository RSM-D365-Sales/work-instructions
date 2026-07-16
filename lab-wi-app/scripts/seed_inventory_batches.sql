-- ============================================================
-- DEMO SEED: Inventory batches (lots) under the on-hand summary
-- ------------------------------------------------------------
--   Splits every inventory_on_hand row's physical_inventory into
--   1–3 batches whose quantities sum EXACTLY to the summary, so
--   the drill-down and cycle count reconcile with the totals.
--
--   * Batch numbers look like production lots: B250614-0001
--     (date part = a plausible received date in the ~60 days
--     before the demo window; sequence keeps them unique).
--   * received_at matches the batch-number date.
--
--   Re-run AFTER reseeding inventory_on_hand — it wipes and
--   rebuilds all batches from the current summary quantities.
--   Run in the Supabase SQL Editor (after migration 045).
-- ============================================================

DO $$
DECLARE
  demo_day  constant date := DATE '2026-07-22';
  r         record;
  remaining numeric;
  n         int;
  i         int;
  q         numeric;
  d         date;
  seq       int := 0;
BEGIN
  DELETE FROM public.inventory_batches;

  FOR r IN
    SELECT ioh.reagent_item_id, ioh.lab_id, ioh.physical_inventory
      FROM public.inventory_on_hand ioh
     WHERE ioh.physical_inventory > 0
  LOOP
    remaining := r.physical_inventory;
    n := 1 + floor(random() * 3)::int;   -- 1–3 batches per item×lab

    FOR i IN 1..n LOOP
      EXIT WHEN remaining <= 0;
      seq := seq + 1;

      IF i = n THEN
        q := remaining;                                        -- last batch takes the rest
      ELSE
        q := LEAST(remaining, GREATEST(1, round(remaining * (0.3 + random() * 0.4))));
      END IF;

      d := demo_day - (5 + floor(random() * 60))::int;         -- received in the last ~2 months

      INSERT INTO public.inventory_batches
        (reagent_item_id, lab_id, batch_number, quantity, received_at)
      VALUES
        (r.reagent_item_id, r.lab_id,
         'B' || to_char(d, 'YYMMDD') || '-' || lpad(seq::text, 4, '0'),
         q,
         (d::timestamp + INTERVAL '9 hours'));

      remaining := remaining - q;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Seeded % inventory batches.', seq;
END $$;

-- Verify every item×lab reconciles: batch sums must equal the summary.
SELECT count(*)                                            AS summary_rows,
       count(*) FILTER (WHERE b.batch_sum = ioh.physical_inventory) AS reconciled,
       count(*) FILTER (WHERE b.batch_sum IS DISTINCT FROM ioh.physical_inventory
                          AND ioh.physical_inventory > 0)  AS mismatched
  FROM public.inventory_on_hand ioh
  LEFT JOIN (
    SELECT reagent_item_id, lab_id, sum(quantity) AS batch_sum
      FROM public.inventory_batches
     GROUP BY reagent_item_id, lab_id
  ) b ON b.reagent_item_id = ioh.reagent_item_id AND b.lab_id = ioh.lab_id;

-- Spread: batches per lab.
SELECT l.name, count(*) AS batches, sum(ib.quantity) AS total_qty
  FROM public.inventory_batches ib
  JOIN public.labs l ON l.id = ib.lab_id
 GROUP BY l.name
 ORDER BY l.name;
