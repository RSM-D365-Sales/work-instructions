-- ============================================================
-- DEMO RESET — July 22 2026 demo
-- ------------------------------------------------------------
-- Wipes ALL production orders, reagent orders and on-hand
-- inventory, then rebuilds 4 weeks of demo data starting
-- Mon Jul 20 2026 (through Sun Aug 16 2026) with EVERYTHING
-- pending + unscheduled + unassigned, ready for the demo:
--
--   WIPED (cascades in parentheses):
--     * production_orders   (po_steps, qc_results, qc_certificates)
--     * reagent_orders      (reagent_order_items)
--     * inventory_on_hand   — reseed with the separate inventory
--                             script (10 items per Lab 1–4, all
--                             items at the REAGENT lab)
--
--   NOT TOUCHED:
--     * work_instructions / wi_steps / wi_approvals / step_templates
--     * qc_tests (the QC specs per item), reagent_items, labs,
--       profiles, scales, d365_config
--
--   REBUILT:
--     * Reagent orders  — ~4 per requesting lab per day (3–5),
--       1–3 line items each, ALL 'pending'; ~25% carry a note,
--       ~15% high priority, ~10% flagged insufficient_stock (feeds
--       the planner dashboard tile / create-production-order flow).
--       Lab 2's orders are requested by Jimmy. Native RO-2026-NNNN
--       numbering (sequence restarted).
--     * Production orders — ~18–24 per day, ALL 'pending' with
--       scheduled_start/end NULL (Unscheduled Orders queue),
--       assigned_to NULL (the auto-scheduler picks the person),
--       required_by spread across the 4 weeks. Native MAN######
--       numbering (sequence restarted).
--     * Nothing is created in the past: every order's created_at
--       falls Jul 15–21 2026 (business hours, Mountain time), so
--       on demo day (Jul 22) nothing looks future-entered.
--
--   Safe to re-run: it deletes everything it seeds (and everything
--   else in those three tables) each time.
--
--   Run in the Supabase SQL Editor (after migrations 001–041;
--   labs, reagent items and approved WIs must already exist).
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- PART 1 · WIPE
-- production_orders first (its source_reagent_order_id would
-- otherwise be nulled row-by-row when reagent orders are deleted).
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.production_orders;    -- cascades po_steps, qc_results, qc_certificates
DELETE FROM public.reagent_orders;       -- cascades reagent_order_items
DELETE FROM public.inventory_on_hand;    -- reseeded by the separate inventory script

-- Fresh, tidy demo numbering (tables are empty, so this is safe).
ALTER SEQUENCE public.reagent_orders_seq          RESTART WITH 1;  -- RO-2026-0001 …
ALTER SEQUENCE public.production_order_manual_seq RESTART WITH 1;  -- MAN000001 …

-- ─────────────────────────────────────────────────────────────
-- PART 2 · REAGENT ORDERS  (Jul 20 – Aug 16 2026, all pending)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  d_start    constant date := DATE '2026-07-20';
  d_end      constant date := DATE '2026-08-16';   -- 4 full weeks
  c_lo       constant date := DATE '2026-07-15';   -- earliest "entered on" date
  c_hi       constant date := DATE '2026-07-21';   -- latest — the day before the demo
  tz         constant text := 'America/Denver';    -- build created_at in Mountain time

  v_labs     uuid[];
  v_items    uuid[];
  v_lab2     uuid;     -- the "Lab 2" lab (orders attributed to Jimmy)
  v_jimmy    uuid;     -- profile named Jimmy
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
  c_cap       date;
  lab         uuid;
  v_requester uuid;
  i           int;
  n_orders    int;
  n_items     int;
  j           int;
  it          uuid;
  used        uuid[];
  seq         int := 0;
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
    RAISE NOTICE 'Lab 2 found but no profile named "Jimmy" exists — Lab 2 orders will use the default requester.';
  END IF;

  FOR d IN SELECT generate_series(d_start, d_end, INTERVAL '1 day')::date LOOP
    -- Entered somewhere between c_lo and the day before it's needed,
    -- but never after Jul 21 — so nothing is future-created on demo day.
    c_cap := LEAST(d - 1, c_hi);

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
        v_note    := CASE WHEN random() < 0.25
                          THEN notes_pool[1 + floor(random() * array_length(notes_pool, 1))::int]
                          ELSE NULL END;
        v_created := ((c_lo + floor(random() * (c_cap - c_lo + 1))::int)::timestamp
                      + INTERVAL '7 hours' + (random() * INTERVAL '9 hours')) AT TIME ZONE tz;

        INSERT INTO public.reagent_orders
          (lab_id, requested_for_date, notes, high_priority, insufficient_stock,
           status, created_by, requested_by, created_at)
        VALUES
          (lab, d, v_note,
           (random() < 0.15),          -- ~15% high priority
           (random() < 0.10),          -- ~10% flagged insufficient stock
           'pending', v_requester, v_requester, v_created)
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

  RAISE NOTICE 'Seeded % pending reagent orders across % labs (Jul 20 – Aug 16 2026).',
               seq, array_length(v_labs, 1);
END $$;

-- ─────────────────────────────────────────────────────────────
-- PART 3 · PRODUCTION ORDERS  (Jul 20 – Aug 16 2026,
--          all pending + UNSCHEDULED + unassigned)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  d_start   constant date := DATE '2026-07-20';
  d_end     constant date := DATE '2026-08-16';   -- 4 full weeks
  c_lo      constant date := DATE '2026-07-15';   -- earliest "entered on" date
  c_hi      constant date := DATE '2026-07-21';   -- latest — the day before the demo
  tz        constant text := 'America/Denver';

  v_people  uuid[];    -- order creators (rotated; orders stay UNassigned)
  v_wis     uuid[];    -- approved work instruction ids
  v_batches numeric[] := ARRAY[1, 2, 5, 10, 20];

  d         date;
  c_cap     date;
  n         int;       -- orders required on this day
  i         int;
  seq       int := 0;  -- global counter → unique lots & varied picks
  wi_id     uuid;
  wi_ver    int;
  bsize     numeric;
  creator   uuid;
  v_created timestamptz;
BEGIN
  -- Order creators, resolved by the demo email addresses.
  SELECT array_agg(id ORDER BY lower(email)) INTO v_people FROM public.profiles
   WHERE lower(email) IN (
     'peter@lab.com','tommy@lab.com','olivia@lab.com','frank@lab.com',  -- operators
     'ron@lab.com','ryan@lab.com','andrew@lab.com');                    -- admins
  IF v_people IS NULL THEN
    RAISE EXCEPTION 'No matching demo profiles found — check the email list.';
  END IF;

  -- Approved work instructions are the only ones a production order may use.
  SELECT array_agg(id ORDER BY created_at) INTO v_wis
    FROM public.work_instructions WHERE status = 'approved';
  IF v_wis IS NULL OR array_length(v_wis, 1) = 0 THEN
    RAISE EXCEPTION 'No approved work instructions found — approve some WIs first.';
  END IF;

  FOR d IN SELECT generate_series(d_start, d_end, INTERVAL '1 day')::date LOOP
    c_cap := LEAST(d - 1, c_hi);
    n := 18 + floor(random() * 7)::int;    -- 18–24 required per day, ~21 avg

    FOR i IN 1..n LOOP
      seq := seq + 1;

      -- Pick a (varied) approved WI and read its version.
      wi_id := v_wis[1 + ((seq + i) % array_length(v_wis, 1))];
      SELECT version INTO wi_ver FROM public.work_instructions WHERE id = wi_id;

      bsize   := v_batches[1 + (seq % array_length(v_batches, 1))];
      creator := v_people[1 + (seq % array_length(v_people, 1))];
      v_created := ((c_lo + floor(random() * (c_cap - c_lo + 1))::int)::timestamp
                    + INTERVAL '7 hours' + (random() * INTERVAL '9 hours')) AT TIME ZONE tz;

      -- Everything UNSCHEDULED: scheduled_start/end NULL puts it in the
      -- Unscheduled Orders queue; assigned_to NULL lets the auto-scheduler
      -- pick the person; required_by drives its priority in that queue.
      INSERT INTO public.production_orders
        (work_instruction_id, wi_version, lot_number, batch_size, batch_size_unit,
         status, created_by, assigned_to,
         scheduled_start, scheduled_end, started_at, completed_at,
         required_by, created_at)
      VALUES
        (wi_id, wi_ver,
         'L' || to_char(d, 'YYMMDD') || '-' || lpad(seq::text, 4, '0'),
         bsize, 'L',
         'pending', creator, NULL,
         NULL, NULL, NULL, NULL,
         d, v_created);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Seeded % pending, unscheduled production orders (Jul 20 – Aug 16 2026).', seq;
END $$;

-- ─────────────────────────────────────────────────────────────
-- PART 4 · VERIFY
-- ─────────────────────────────────────────────────────────────

-- Everything should be pending / unscheduled / unassigned, spread over 4 weeks:
SELECT status,
       count(*)                                        AS orders,
       count(*) FILTER (WHERE scheduled_start IS NULL) AS unscheduled,
       count(*) FILTER (WHERE assigned_to IS NULL)     AS unassigned,
       min(required_by)                                AS first_required,
       max(required_by)                                AS last_required
  FROM public.production_orders
 GROUP BY status;

-- Production demand per week of the window:
SELECT to_char(date_trunc('week', required_by), 'Mon DD') AS week_of,
       count(*)                                           AS orders
  FROM public.production_orders
 GROUP BY 1
 ORDER BY min(required_by);

-- Reagent orders per lab (all pending; who requests them; priority/stock flags):
SELECT l.name                                          AS lab,
       string_agg(DISTINCT p.full_name, ', ')          AS requesters,
       count(*)                                        AS orders,
       round(count(*)::numeric / 28, 1)                AS per_day,
       count(*) FILTER (WHERE ro.high_priority)        AS high_priority,
       count(*) FILTER (WHERE ro.insufficient_stock)   AS insufficient_stock
  FROM public.reagent_orders ro
  JOIN public.labs l     ON l.id = ro.lab_id
  JOIN public.profiles p ON p.id = ro.requested_by
 GROUP BY l.name
 ORDER BY l.name;

-- Line items per order and the note rate:
SELECT count(*)                                                       AS orders,
       round(avg(li.cnt), 2)                                          AS avg_items,
       round(100.0 * count(*) FILTER (WHERE ro.notes IS NOT NULL) / count(*), 0) AS pct_with_notes
  FROM public.reagent_orders ro
  JOIN LATERAL (SELECT count(*) AS cnt FROM public.reagent_order_items i WHERE i.order_id = ro.id) li ON true;

-- Inventory is empty until the separate inventory seed runs:
SELECT count(*) AS inventory_rows FROM public.inventory_on_hand;
