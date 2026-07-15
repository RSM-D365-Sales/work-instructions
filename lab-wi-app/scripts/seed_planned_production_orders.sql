-- ============================================================
-- DEMO SEED: Planned production orders, Jul 20 – Aug 16 2026
-- ------------------------------------------------------------
--   Stands in for D365 Master Planning output (planned production /
--   planned batch orders) until a live sync exists.
--
--   * 4–7 planned orders per day across the 4-week demo window,
--     requirement dates Jul 20 → Aug 16 2026 — matching the demo
--     reset (scripts/reset_demo_data.sql).
--   * Items: FG reagent items that have an APPROVED work instruction,
--     so every planned order can be firmed against its default
--     formula in the app.
--   * order_date = requirement_date − 0–5 days (planned start on or
--     before the demand date, as Planning Optimization would set it).
--   * delivery_date = requirement_date.
--   * Pegging: 1–2 demand lines per order — mostly 'Transfer order'
--     (lab replenishment) plus some 'Safety stock' (item coverage
--     minimum), with quantities that sum to the order quantity.
--   * All 'unprocessed', numbered G60G0126###### (sequence restarted).
--
--   Safe to re-run: wipes the whole table first.
--   Run in the Supabase SQL Editor (after migration 042).
-- ============================================================

DO $$
DECLARE
  d_start   constant date := DATE '2026-07-20';
  d_end     constant date := DATE '2026-08-16';   -- 4 full weeks

  v_items    uuid[];
  v_qty      numeric[] := ARRAY[1, 2, 5, 10, 20];

  d          date;
  n          int;
  i          int;
  seq        int := 0;
  item_id    uuid;
  v_unit     text;
  v_itemno   text;
  qty        numeric;
  v_order    date;
  v_pegging  jsonb;
  split_qty  numeric;
BEGIN
  -- Only items the app can actually firm: an approved WI is the
  -- "default formula" a firmed production order is created against.
  SELECT array_agg(DISTINCT ri.id) INTO v_items
    FROM public.reagent_items ri
    JOIN public.work_instructions wi
      ON wi.reagent_item_id = ri.id AND wi.status = 'approved'
   WHERE ri.is_active = true;
  IF v_items IS NULL OR array_length(v_items, 1) = 0 THEN
    RAISE EXCEPTION 'No active reagent items with an approved work instruction found.';
  END IF;

  -- Clean slate + tidy numbering.
  DELETE FROM public.planned_production_orders;
  ALTER SEQUENCE public.planned_orders_seq RESTART WITH 1;

  FOR d IN SELECT generate_series(d_start, d_end, INTERVAL '1 day')::date LOOP
    n := 4 + floor(random() * 4)::int;    -- 4–7 per day

    FOR i IN 1..n LOOP
      seq := seq + 1;

      item_id := v_items[1 + floor(random() * array_length(v_items, 1))::int];
      SELECT unit_of_measure, item_number INTO v_unit, v_itemno
        FROM public.reagent_items WHERE id = item_id;

      qty     := v_qty[1 + (seq % array_length(v_qty, 1))];
      v_order := d - floor(random() * 6)::int;    -- start 0–5 days before the demand

      -- Pegging: what demand this supply covers.
      IF random() < 0.35 AND qty >= 2 THEN
        -- Two demand lines splitting the quantity: a lab transfer + safety stock.
        split_qty := GREATEST(1, round(qty * (0.3 + random() * 0.4)));
        v_pegging := jsonb_build_array(
          jsonb_build_object(
            'reference', 'Transfer order',
            'number', 'TO-' || lpad((2000 + seq)::text, 6, '0'),
            'requirement_date', to_char(d, 'YYYY-MM-DD'),
            'quantity', qty - split_qty),
          jsonb_build_object(
            'reference', 'Safety stock',
            'number', NULL,
            'requirement_date', to_char(d, 'YYYY-MM-DD'),
            'quantity', split_qty)
        );
      ELSIF random() < 0.75 THEN
        v_pegging := jsonb_build_array(
          jsonb_build_object(
            'reference', 'Transfer order',
            'number', 'TO-' || lpad((2000 + seq)::text, 6, '0'),
            'requirement_date', to_char(d, 'YYYY-MM-DD'),
            'quantity', qty)
        );
      ELSE
        v_pegging := jsonb_build_array(
          jsonb_build_object(
            'reference', 'Safety stock',
            'number', NULL,
            'requirement_date', to_char(d, 'YYYY-MM-DD'),
            'quantity', qty)
        );
      END IF;

      INSERT INTO public.planned_production_orders
        (reagent_item_id, quantity, unit,
         requirement_date, order_date, delivery_date,
         planning_priority, site, warehouse, plan_name,
         bom_number, pegging, status)
      VALUES
        (item_id, qty, COALESCE(v_unit, 'L'),
         d, v_order, d,
         0, '1', 'REAGENT', 'Master',
         'BOM-' || v_itemno, v_pegging, 'unprocessed');
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Seeded % unprocessed planned production orders (Jul 20 – Aug 16 2026).', seq;
END $$;

-- Verify the spread and that every item is firmable (has an approved WI):
SELECT po.status,
       count(*)                          AS planned_orders,
       min(po.requirement_date)          AS first_req,
       max(po.requirement_date)          AS last_req,
       count(*) FILTER (WHERE po.order_date <= po.requirement_date) AS start_on_or_before_req
  FROM public.planned_production_orders po
 GROUP BY po.status;

SELECT ri.item_number, ri.product_name,
       count(*)                                        AS planned_orders,
       bool_and(EXISTS (
         SELECT 1 FROM public.work_instructions wi
          WHERE wi.reagent_item_id = ri.id AND wi.status = 'approved'
       ))                                              AS firmable
  FROM public.planned_production_orders po
  JOIN public.reagent_items ri ON ri.id = po.reagent_item_id
 GROUP BY ri.item_number, ri.product_name
 ORDER BY ri.item_number;
