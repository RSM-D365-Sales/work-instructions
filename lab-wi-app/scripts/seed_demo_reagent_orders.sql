-- ============================================================
-- DEMO SEED: Reagent orders, ~4 per lab per day, Jun 3–11 2026
-- ------------------------------------------------------------
--   * One run per active requesting lab (the central REAGENT production
--     lab is excluded — it fulfils orders, it doesn't place them).
--   * ~4 orders/lab/day (randomly 3–5), each with 1–3 distinct line items.
--   * ~25% of orders carry a free-text note; ~15% are high priority.
--   * Mostly 'pending' (deliverable), ~20% 'in_progress'.
--   * Lab 2's orders are requested by Jimmy; other labs by a lab member.
--
--   Orders are tagged with an order_number prefixed 'RO-DEMO-' and the
--   script DELETES any prior 'RO-DEMO-%' orders first (line items cascade),
--   so it is safe to re-run / easy to clean up:
--       DELETE FROM public.reagent_orders WHERE order_number LIKE 'RO-DEMO-%';
--
--   Run in the Supabase SQL Editor (after migration 027; labs + reagent
--   items must already exist).
-- ============================================================

DO $$
DECLARE
  d_start   constant date := DATE '2026-06-03';
  d_end     constant date := DATE '2026-06-11';
  tz        constant text := 'America/Denver';   -- build created_at in local (Mountain) time

  v_labs    uuid[];
  v_items   uuid[];
  v_lab2    uuid;     -- the "Lab 2" lab (orders attributed to Jimmy)
  v_jimmy   uuid;     -- profile named Jimmy
  notes_pool text[] := ARRAY[
    'Please prioritise — running low for afternoon assays.',
    'Deliver to cold room, shelf 3.',
    'Substitute lot OK if the current lot is unavailable.',
    'Needed before 10am for the QC run.',
    'Call ext. 4421 on arrival at the dock.',
    'Combine with our standing weekly order if possible.',
    'Short-dated stock is fine for this request.'
  ];

  d           date;
  lab         uuid;
  v_requester uuid;
  i           int;
  n_orders    int;
  n_items     int;
  j           int;
  it          uuid;
  used        uuid[];
  seq         int := 0;
  v_status    text;
  v_note      text;
  v_created   timestamptz;
  v_order_id  uuid;
BEGIN
  -- Requesting labs = active labs other than the central REAGENT lab.
  SELECT array_agg(id ORDER BY name) INTO v_labs
    FROM public.labs
   WHERE is_active = true
     AND upper(COALESCE(warehouse_id, '')) <> 'REAGENT'
     AND upper(name) NOT LIKE '%REAGENT%';
  IF v_labs IS NULL THEN
    RAISE EXCEPTION 'No requesting labs found — need active labs other than the REAGENT lab.';
  END IF;

  SELECT array_agg(id) INTO v_items FROM public.reagent_items WHERE is_active = true;
  IF v_items IS NULL OR array_length(v_items, 1) = 0 THEN
    RAISE EXCEPTION 'No active reagent items found to order.';
  END IF;

  -- Lab 2 is requested by Jimmy (resolve both; warn if Jimmy is missing).
  SELECT id INTO v_lab2 FROM public.labs WHERE name ILIKE 'lab%2' ORDER BY name LIMIT 1;
  SELECT id INTO v_jimmy FROM public.profiles WHERE full_name ILIKE 'jimmy%' ORDER BY created_at LIMIT 1;
  IF v_lab2 IS NOT NULL AND v_jimmy IS NULL THEN
    RAISE NOTICE 'Lab 2 found but no profile named "Jimmy" exists — Lab 2 orders will use the default requester. Create Jimmy first to attribute them.';
  END IF;

  -- Clean any previous run so this is idempotent (line items cascade).
  DELETE FROM public.reagent_orders WHERE order_number LIKE 'RO-DEMO-%';

  FOR d IN SELECT generate_series(d_start, d_end, INTERVAL '1 day')::date LOOP
    FOREACH lab IN ARRAY v_labs LOOP

      -- Requester: Lab 2 is always placed by Jimmy; other labs prefer a 'lab'
      -- member of the lab, else any lab/operator user.
      IF lab = v_lab2 AND v_jimmy IS NOT NULL THEN
        v_requester := v_jimmy;
      ELSE
        SELECT id INTO v_requester FROM public.profiles
          WHERE default_lab_id = lab
          ORDER BY (role = 'lab') DESC, created_at
          LIMIT 1;
        IF v_requester IS NULL THEN
          SELECT id INTO v_requester FROM public.profiles
            ORDER BY (role = 'lab') DESC, (role = 'operator') DESC, created_at
            LIMIT 1;
        END IF;
      END IF;

      n_orders := 3 + floor(random() * 3)::int;   -- 3–5, ~4 avg
      FOR i IN 1 .. n_orders LOOP
        seq := seq + 1;
        v_status  := CASE WHEN random() < 0.20 THEN 'in_progress' ELSE 'pending' END;
        v_note    := CASE WHEN random() < 0.25
                          THEN notes_pool[1 + floor(random() * array_length(notes_pool, 1))::int]
                          ELSE NULL END;
        -- Placed the day before it's needed, during working hours (local tz).
        v_created := ((d - 1)::timestamp + INTERVAL '7 hours' + (random() * INTERVAL '9 hours')) AT TIME ZONE tz;

        INSERT INTO public.reagent_orders
          (order_number, lab_id, requested_for_date, notes, high_priority, status,
           created_by, requested_by, created_at)
        VALUES
          ('RO-DEMO-' || lpad(seq::text, 5, '0'), lab, d, v_note,
           (random() < 0.15), v_status, v_requester, v_requester, v_created)
        RETURNING id INTO v_order_id;

        -- 1–3 distinct items (capped at how many items exist).
        n_items := LEAST(1 + floor(random() * 3)::int, array_length(v_items, 1));
        used := ARRAY[]::uuid[];
        FOR j IN 1 .. n_items LOOP
          LOOP
            it := v_items[1 + floor(random() * array_length(v_items, 1))::int];
            EXIT WHEN NOT (it = ANY(used));
          END LOOP;
          used := used || it;
          INSERT INTO public.reagent_order_items (order_id, line_number, reagent_item_id, quantity, unit)
          SELECT v_order_id, j, ri.id, (1 + floor(random() * 10))::numeric, ri.unit_of_measure
            FROM public.reagent_items ri WHERE ri.id = it;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Seeded % demo reagent orders across % labs (Jun 3–11 2026).', seq, array_length(v_labs, 1);
END $$;

-- Verify the spread per lab (and who requests each lab's orders):
SELECT l.name AS lab,
       string_agg(DISTINCT p.full_name, ', ')         AS requesters,
       count(*)                                       AS orders,
       round(count(*)::numeric / 9, 1)                AS per_day,
       count(*) FILTER (WHERE ro.high_priority)       AS high_priority
  FROM public.reagent_orders ro
  JOIN public.labs l     ON l.id = ro.lab_id
  JOIN public.profiles p ON p.id = ro.requested_by
 WHERE ro.order_number LIKE 'RO-DEMO-%'
 GROUP BY l.name
 ORDER BY l.name;

-- Verify items-per-order and the note rate:
SELECT count(*)                                                      AS orders,
       round(avg(li.cnt), 2)                                         AS avg_items,
       count(*) FILTER (WHERE ro.notes IS NOT NULL)                  AS with_notes,
       round(100.0 * count(*) FILTER (WHERE ro.notes IS NOT NULL) / count(*), 0) AS pct_with_notes
  FROM public.reagent_orders ro
  JOIN LATERAL (SELECT count(*) AS cnt FROM public.reagent_order_items i WHERE i.order_id = ro.id) li ON true
 WHERE ro.order_number LIKE 'RO-DEMO-%';
