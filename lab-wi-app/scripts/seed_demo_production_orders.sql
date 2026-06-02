-- ============================================================
-- DEMO SEED: Production orders, ~5 per person per day, Jun 1–14 2026
-- ------------------------------------------------------------
--   * Primary producers (operators + lab) get ~5 orders/day each.
--   * A few orders/day are sprinkled to admins Ron, Ryan, Andrew.
--   * Dates BEFORE Jun 4  → 'completed' or 'awaiting_qc'
--       (production finished; started_at/completed_at + schedule set).
--   * Dates Jun 4 ONWARD  → 'pending', either SCHEDULED (scheduled_start
--       set, ~70%) or UNSCHEDULED (scheduled_start NULL → shows in the
--       Unscheduled Orders queue, ~30%).
--   * Status + dates only — no po_steps / qc_results are generated.
--
--   Every row is tagged notes = 'DEMO-SEED' and the script DELETES any
--   prior 'DEMO-SEED' orders first, so it is safe to re-run and easy to
--   clean up:  DELETE FROM public.production_orders WHERE notes='DEMO-SEED';
--
--   Run in the Supabase SQL Editor (after migrations 001–035).
-- ============================================================

DO $$
DECLARE
  today      constant date := DATE '2026-06-02';   -- the demo "now"
  d_start    constant date := DATE '2026-06-01';
  d_end      constant date := DATE '2026-06-14';
  cutover    constant date := DATE '2026-06-04';   -- < cutover = done; >= = planned

  v_all      uuid[];     -- everyone who receives orders
  v_admins   uuid[];     -- lighter-load admins
  v_wis      uuid[];     -- approved work instruction ids
  v_batches  numeric[] := ARRAY[1, 2, 5, 10, 20];

  d          date;
  person     uuid;
  is_admin   boolean;
  n          int;        -- orders for this person this day
  i          int;
  seq        int := 0;   -- global counter → unique lots & varied picks

  wi_id      uuid;
  wi_ver     int;
  wi_min     int;
  bsize      numeric;

  v_start    timestamptz;
  v_end      timestamptz;
  v_status   text;
  v_sched_s  timestamptz;
  v_sched_e  timestamptz;
  v_started  timestamptz;
  v_done     timestamptz;
  v_reqby    date;
  v_created  timestamptz;
BEGIN
  -- Resolve people by the demo email addresses (case-insensitive).
  SELECT array_agg(id) INTO v_all FROM public.profiles
   WHERE lower(email) IN (
     'peter@lab.com','tommy@lab.com','olivia@lab.com','frank@lab.com',  -- operators
     'dana@lab.com','lab1@lab.com',                                     -- lab
     'ron@lab.com','ryan@lab.com','andrew@lab.com');                    -- a few admins

  SELECT array_agg(id) INTO v_admins FROM public.profiles
   WHERE lower(email) IN ('ron@lab.com','ryan@lab.com','andrew@lab.com');

  IF v_all IS NULL THEN
    RAISE EXCEPTION 'No matching demo profiles found — check the email list.';
  END IF;

  -- Approved work instructions are the only ones a production order may use.
  SELECT array_agg(id ORDER BY created_at) INTO v_wis
    FROM public.work_instructions WHERE status = 'approved';
  IF v_wis IS NULL OR array_length(v_wis, 1) = 0 THEN
    RAISE EXCEPTION 'No approved work instructions found — approve some WIs first.';
  END IF;

  -- Clean any previous run so this is idempotent.
  DELETE FROM public.production_orders WHERE notes = 'DEMO-SEED';

  FOR d IN SELECT generate_series(d_start, d_end, INTERVAL '1 day')::date LOOP
    FOREACH person IN ARRAY v_all LOOP
      is_admin := person = ANY(v_admins);
      -- Operators/lab ~5/day (4–6); admins lightly (1–2/day).
      n := CASE WHEN is_admin THEN 1 + floor(random() * 2)::int
                ELSE 4 + floor(random() * 3)::int END;

      FOR i IN 1..n LOOP
        seq := seq + 1;

        -- Pick a (varied) approved WI and read its version/duration.
        wi_id := v_wis[1 + ((seq + i) % array_length(v_wis, 1))];
        SELECT version, COALESCE(scheduled_minutes, 120)
          INTO wi_ver, wi_min
          FROM public.work_instructions WHERE id = wi_id;

        bsize   := v_batches[1 + (seq % array_length(v_batches, 1))];
        -- Stagger each person's runs through the working day.
        v_start := (d + TIME '07:00') + ((i - 1) * INTERVAL '105 minutes');
        v_end   := v_start + (wi_min * INTERVAL '1 minute');

        IF d < cutover THEN
          -- Finished batches: ~60% completed, ~40% awaiting QC.
          v_status  := CASE WHEN (seq % 5) < 3 THEN 'completed' ELSE 'awaiting_qc' END;
          v_sched_s := v_start;
          v_sched_e := v_end;
          v_started := v_start;
          v_done    := v_end;        -- production complete (QC may still be open)
          v_reqby   := NULL;
          v_created := v_start;
        ELSE
          -- Planned batches: pending, ~70% scheduled / ~30% unscheduled.
          v_status  := 'pending';
          v_started := NULL;
          v_done    := NULL;
          v_created := today + TIME '08:00';
          IF (seq % 10) < 7 THEN
            v_sched_s := v_start;     -- SCHEDULED → shows on the gantt
            v_sched_e := v_end;
            v_reqby   := d + 2;
          ELSE
            v_sched_s := NULL;        -- UNSCHEDULED → Unscheduled Orders queue
            v_sched_e := NULL;
            v_reqby   := d + 3;
          END IF;
        END IF;

        INSERT INTO public.production_orders
          (work_instruction_id, wi_version, lot_number, batch_size, batch_size_unit,
           notes, status, created_by, assigned_to,
           scheduled_start, scheduled_end, started_at, completed_at, required_by, created_at)
        VALUES
          (wi_id, wi_ver,
           'L' || to_char(d, 'YYMMDD') || '-' || lpad(seq::text, 4, '0'),
           bsize, 'L',
           'DEMO-SEED', v_status, person, person,
           v_sched_s, v_sched_e, v_started, v_done, v_reqby, v_created);
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Seeded % demo production orders (Jun 1–14 2026).', seq;
END $$;

-- Quick verification of the spread:
SELECT status,
       count(*)                                            AS orders,
       count(*) FILTER (WHERE scheduled_start IS NULL)     AS unscheduled,
       min(created_at)::date AS first_day, max(created_at)::date AS last_day
  FROM public.production_orders
 WHERE notes = 'DEMO-SEED'
 GROUP BY status
 ORDER BY status;
