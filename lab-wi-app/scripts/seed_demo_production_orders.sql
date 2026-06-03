-- ============================================================
-- DEMO SEED: Production orders, ~5 per person per working day, Jun 1–14 2026
-- ------------------------------------------------------------
--   * The lab runs 7 days a week, but each person works only 5 of the 7 —
--     each gets 2 staggered days off (by weekday), so weekends still have
--     reduced activity and nobody is scheduled every single day.
--   * Operators get ~5 orders per working day. NO orders for the "Lab" role.
--   * A few orders/working day are sprinkled to admins Ron, Ryan, Andrew.
--   * Dates BEFORE Jun 4  → finished: mostly 'completed' / 'awaiting_qc', with
--       a small ~8% 'failed' (one QC test out of spec). started_at/completed_at
--       + schedule set.
--   * Dates Jun 4 ONWARD  → 'pending', either SCHEDULED (scheduled_start
--       set, ~70%) or UNSCHEDULED (scheduled_start NULL → shows in the
--       Unscheduled Orders queue, ~30%).
--   * Awaiting-QC, completed AND failed orders get a fully-completed production
--     step per WI step (lightly-realistic captured values, timestamps spread
--     across the run). Completed + failed orders also get a QC result per test
--     feeding the Quality Trends charts: completed = all in spec + a released
--     COA; failed = the first numeric test is out of spec (no COA) so a failing
--     point shows on the trend. Pending (planned) orders stay status+dates only.
--
--   Every row is tagged notes = 'DEMO-SEED' and the script DELETES any
--   prior 'DEMO-SEED' orders first, so it is safe to re-run and easy to
--   clean up:  DELETE FROM public.production_orders WHERE notes='DEMO-SEED';
--
--   Run in the Supabase SQL Editor (after migrations 001–035).
-- ============================================================

DO $$
DECLARE
  -- Wall-clock times are built in this timezone so they display in business
  -- hours (not shifted to ~midnight) for the demo viewer. Change to match.
  tz         constant text := 'America/Denver';     -- Mountain time
  today      constant date := DATE '2026-06-02';   -- the demo "now"
  d_start    constant date := DATE '2026-06-01';
  d_end      constant date := DATE '2026-06-14';
  cutover    constant date := DATE '2026-06-04';   -- < cutover = done; >= = planned

  v_all      uuid[];     -- everyone who receives orders
  v_admins   uuid[];     -- lighter-load admins
  v_wis      uuid[];     -- approved work instruction ids
  v_batches  numeric[] := ARRAY[1, 2, 5, 10, 20];

  d          date;
  p_idx      int;        -- person's position in v_all (drives their days off)
  person     uuid;
  off1       int;        -- weekday (DOW 0=Sun..6=Sat) this person is off
  off2       int;        -- second day off
  is_admin   boolean;
  n          int;        -- orders for this person this day
  i          int;
  seq        int := 0;   -- global counter → unique lots & varied picks

  wi_id      uuid;
  wi_ver     int;
  wi_min     int;
  bsize      numeric;
  v_order_id uuid;     -- id of the order just inserted (for step fan-out)
  v_item_id  uuid;     -- reagent item behind the WI (for QC results)

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
  -- Ordered so each person's days-off assignment is stable across re-runs.
  -- NOTE: no "Lab" role people (Dana, Lab 1 Scientist) — operators + a few admins only.
  SELECT array_agg(id ORDER BY lower(email)) INTO v_all FROM public.profiles
   WHERE lower(email) IN (
     'peter@lab.com','tommy@lab.com','olivia@lab.com','frank@lab.com',  -- operators
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
    FOR p_idx IN 1 .. array_length(v_all, 1) LOOP
      person := v_all[p_idx];

      -- Each person works 5 of 7 days: give them 2 consecutive days off,
      -- staggered by their position so the lab stays staffed every day
      -- (incl. weekends) and no one is scheduled all 7 days.
      off1 := ((p_idx - 1) * 2)     % 7;
      off2 := ((p_idx - 1) * 2 + 1) % 7;
      CONTINUE WHEN extract(dow FROM d)::int IN (off1, off2);

      is_admin := person = ANY(v_admins);
      -- Operators ~5/day (4–6); admins lightly (1–2/day).
      n := CASE WHEN is_admin THEN 1 + floor(random() * 2)::int
                ELSE 4 + floor(random() * 3)::int END;

      FOR i IN 1..n LOOP
        seq := seq + 1;

        -- Pick a (varied) approved WI and read its version/duration.
        wi_id := v_wis[1 + ((seq + i) % array_length(v_wis, 1))];
        SELECT version, COALESCE(scheduled_minutes, 120), reagent_item_id
          INTO wi_ver, wi_min, v_item_id
          FROM public.work_instructions WHERE id = wi_id;

        bsize   := v_batches[1 + (seq % array_length(v_batches, 1))];
        -- Stagger each person's runs through the working day, starting 06:00
        -- local (built in `tz` so it isn't shifted to the small hours on screen).
        v_start := ((d + TIME '06:00') AT TIME ZONE tz) + ((i - 1) * INTERVAL '105 minutes');
        v_end   := v_start + (wi_min * INTERVAL '1 minute');

        IF d < cutover THEN
          -- Finished batches: a small ~8% failed release (one test out of
          -- spec), the rest ~60% completed / ~40% awaiting QC.
          IF (seq % 12) = 0 THEN
            v_status := 'failed';
          ELSIF (seq % 5) < 3 THEN
            v_status := 'completed';
          ELSE
            v_status := 'awaiting_qc';
          END IF;
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
          v_created := (today + TIME '08:00') AT TIME ZONE tz;
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
           v_sched_s, v_sched_e, v_started, v_done, v_reqby, v_created)
        RETURNING id INTO v_order_id;

        -- Awaiting-QC, completed and failed orders are all production-done: lay
        -- down a fully-completed production step for each WI step, with lightly-
        -- realistic captured values and timestamps spread evenly across the run.
        IF v_status IN ('awaiting_qc', 'completed', 'failed') THEN
          INSERT INTO public.po_steps
            (production_order_id, wi_step_id, step_order, status, actual_values,
             operator_id, started_at, completed_at)
          SELECT
            v_order_id, s.id, s.step_order, 'completed',
            CASE s.stype
              WHEN 'weigh' THEN jsonb_build_object(
                'measured_weight', round((s.target_w * (1 + s.r * s.tol / 100))::numeric, 3),
                'unit',          s.wunit,
                'in_tolerance',  true,
                'deviation_pct', round((s.r * s.tol)::numeric, 2))
              WHEN 'mix' THEN jsonb_build_object(
                'actual_duration_minutes', s.mixmin,
                'completed', true)
              WHEN 'ph_adjust' THEN jsonb_build_object(
                'ph_notes', 'Adjusted to pH ' || s.tph || ' with ' || s.reagent || '; stable on retest.')
              WHEN 'observe' THEN jsonb_build_object(
                'observation', 'Clear, colorless solution; no visible particulates.')
              ELSE jsonb_build_object('completed', true)
            END,
            person,
            v_start + (v_end - v_start) * ((s.rn - 1)::float8 / s.cnt),
            v_start + (v_end - v_start) * (s.rn::float8        / s.cnt)
          FROM (
            SELECT
              ws.id, ws.step_order,
              row_number() OVER (ORDER BY ws.step_order) AS rn,
              count(*)     OVER ()                       AS cnt,
              ws.parameters->>'_step_type'               AS stype,
              (random() - 0.5)                           AS r,        -- −0.5 … 0.5
              (ws.parameters->>'target_weight')::numeric AS target_w,
              COALESCE(ws.parameters->>'unit', 'g')      AS wunit,
              COALESCE((ws.parameters->>'tolerance_pct')::numeric, 2)   AS tol,
              COALESCE((ws.parameters->>'duration_minutes')::numeric, 10) AS mixmin,
              COALESCE(ws.parameters->>'target_ph', '7.0')  AS tph,
              COALESCE(ws.parameters->>'reagent', 'reagent') AS reagent
            FROM public.wi_steps ws
            WHERE ws.work_instruction_id = wi_id
          ) s;
        END IF;

        -- Completed and failed orders went through release testing: capture one
        -- QC result per test (snapshotting the spec). Completed = all in spec
        -- (+ a released COA); failed = the first numeric test (test_order 1, the
        -- pH / primary assay) is pushed out of spec with passed = false and no
        -- certificate — these are the dips you can demo on the Quality Trends.
        IF v_status IN ('completed', 'failed') AND v_item_id IS NOT NULL THEN
          INSERT INTO public.qc_results
            (production_order_id, qc_test_id, test_order, name, unit, result_type,
             lower_limit, upper_limit, target, expected_text, method,
             result_numeric, result_text, passed, instrument, tested_by, tested_at)
          SELECT
            v_order_id, t.id, t.test_order, t.name, t.unit, t.result_type,
            t.lower_limit, t.upper_limit, t.target, t.expected_text, t.method,
            CASE WHEN t.result_type = 'numeric' THEN
              CASE
                WHEN v_status = 'failed' AND t.test_order = 1
                  -- push just past the upper limit so it reads out of spec
                  THEN round((t.upper_limit
                              + COALESCE(t.upper_limit - t.lower_limit, t.upper_limit * 0.1)
                                * (0.1 + random() * 0.1))::numeric, 3)
                ELSE round((
                  CASE
                    WHEN t.lower_limit IS NOT NULL AND t.upper_limit IS NOT NULL
                      THEN (t.lower_limit + t.upper_limit) / 2
                           + (random() - 0.5) * (t.upper_limit - t.lower_limit) * 0.6
                    WHEN t.upper_limit IS NOT NULL THEN t.upper_limit * (0.3 + random() * 0.4)
                    WHEN t.lower_limit IS NOT NULL THEN t.lower_limit * (1 + random() * 0.05)
                    WHEN t.target      IS NOT NULL THEN t.target * (1 + (random() - 0.5) * 0.04)
                    ELSE NULL
                  END)::numeric, 3)
              END
            ELSE NULL END,
            CASE WHEN t.result_type = 'passfail' THEN 'Pass'
                 WHEN t.result_type = 'text'     THEN COALESCE(t.expected_text, 'Conforms')
                 ELSE NULL END,
            NOT (v_status = 'failed' AND t.test_order = 1),   -- the OOS test fails
            'INSTR-' || lpad(((seq % 4) + 1)::text, 2, '0'),
            person,
            v_end + INTERVAL '25 minutes'
          FROM public.qc_tests t
          WHERE t.reagent_item_id = v_item_id AND t.is_active = true;

          -- Released COA (auto-numbered COA-YYYY-####) — passing batches only.
          IF v_status = 'completed'
             AND EXISTS (SELECT 1 FROM public.qc_tests WHERE reagent_item_id = v_item_id AND is_active = true) THEN
            INSERT INTO public.qc_certificates (production_order_id, cert_type, issued_by, issued_at)
            VALUES (v_order_id, 'COA', person, v_end + INTERVAL '45 minutes');
          END IF;
        END IF;
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

-- Confirm every awaiting-QC order has all of its steps completed:
SELECT count(DISTINCT po.id)                                   AS awaiting_qc_orders,
       count(ps.id)                                            AS completed_steps,
       round(count(ps.id)::numeric / NULLIF(count(DISTINCT po.id), 0), 1) AS avg_steps_per_order
  FROM public.production_orders po
  LEFT JOIN public.po_steps ps
         ON ps.production_order_id = po.id AND ps.status = 'completed'
 WHERE po.notes = 'DEMO-SEED' AND po.status = 'awaiting_qc';

-- Quality-trend feedstock: released (completed + failed) lots with captured QC,
-- how many numeric points exist to chart, how many are failing (out of spec),
-- and how many COAs were issued.
SELECT ri.item_number,
       count(DISTINCT po.id)                                  AS released_lots,
       count(qr.id) FILTER (WHERE qr.result_type = 'numeric') AS numeric_points,
       count(qr.id) FILTER (WHERE qr.passed = false)          AS failing_points,
       count(DISTINCT cert.id)                                AS certificates
  FROM public.production_orders po
  JOIN public.work_instructions wi ON wi.id = po.work_instruction_id
  JOIN public.reagent_items     ri ON ri.id = wi.reagent_item_id
  LEFT JOIN public.qc_results       qr   ON qr.production_order_id = po.id
  LEFT JOIN public.qc_certificates  cert ON cert.production_order_id = po.id
 WHERE po.notes = 'DEMO-SEED' AND po.status IN ('completed', 'failed')
 GROUP BY ri.item_number
 ORDER BY ri.item_number;
