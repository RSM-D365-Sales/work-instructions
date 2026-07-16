-- ============================================================
-- DEMO SEED: Quality Trends data for B4 (by-user / by-instrument pivots)
-- ------------------------------------------------------------
--   Creates recent released lots (last ~30 days, ending yesterday) for
--   FG-PBS-1X and FG-TRIS-1M, with completed production steps and QC
--   results shaped to tell the B4 story:
--     * pH readings alternate between "pH Meter 01" (stable at target) and
--       "pH Meter 02" (drifting toward the upper spec limit — the final two
--       PBS readings land OUT of spec, so those lots are 'failed').
--     * Both meters (+ an osmometer) are registered in the equipment master
--       (scales), so the by-instrument pivot matches them and the
--       flag-for-calibration action has real records to target.
--     * tested_by rotates across operators with a small per-person bias on
--       Osmolality, so the by-user pivot shows operator-to-operator variance.
--
--   Idempotent: every order is tagged notes = 'DEMO-SEED-QT' and prior
--   tagged rows are deleted first, so it is safe to re-run. Cleanup:
--     DELETE FROM public.production_orders WHERE notes = 'DEMO-SEED-QT';
--     (child qc_results / po_steps / certificates are removed by this script)
--
--   Run in the Supabase SQL Editor (after migrations, ideally 047 + 048).
--
--   Demo path afterward: Quality Trends → FG-PBS-1X → window "30 days" →
--   Group by "By instrument" → pH Meter 02 trends toward USL (last two lots
--   out of spec) → Flag for calibration → Scales page + admin notification.
-- ============================================================

DO $$
DECLARE
  tag        constant text := 'DEMO-SEED-QT';
  -- Per-person bias applied to Osmolality → visible operator-to-operator
  -- variance on the by-user pivot (scaled to each test's spec span).
  v_bias     constant numeric[] := ARRAY[8, -6, 3, -2, 5, 0];

  v_testers  uuid[];
  n_testers  int;
  v_creator  uuid;

  cfg        record;
  v_item     uuid;
  wi_id      uuid;
  wi_ver     int;
  wi_min     numeric;
  oos_arr    int[];     -- 0-based lot indexes whose pH goes out of spec
  k          int;

  seq        int := 0;
  i          int;
  p          numeric;   -- lot progress 0..1 across the window
  day_off    int;
  v_start    timestamptz;
  v_end      timestamptz;
  t_idx      int;
  tester     uuid;
  meter      text;
  is_oos     boolean;
  v_status   text;
  v_order_id uuid;
  v_old      uuid[];
BEGIN
  PERFORM setseed(0.42);   -- deterministic values across re-runs

  -- ── People ────────────────────────────────────────────────────────────────
  SELECT array_agg(id ORDER BY lower(email)) INTO v_testers
    FROM public.profiles WHERE role = 'operator';
  IF v_testers IS NULL OR array_length(v_testers, 1) < 3 THEN
    SELECT array_agg(id ORDER BY lower(email)) INTO v_testers
      FROM public.profiles WHERE role IN ('operator', 'author');
  END IF;
  IF v_testers IS NULL THEN
    RAISE EXCEPTION 'No operator/author profiles found to attribute tests to.';
  END IF;
  n_testers := array_length(v_testers, 1);

  SELECT id INTO v_creator FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  IF v_creator IS NULL THEN v_creator := v_testers[1]; END IF;

  -- ── Equipment master (matched by the by-instrument pivot) ────────────────
  INSERT INTO public.scales (name, model, manufacturer, location, status, notes, conn_a_type, conn_a_label)
  SELECT v.name, v.model, v.manufacturer, v.location,
         'active'::public.scale_status,
         'Seeded for the B4 quality-trends demo',
         'http_rest'::public.scale_connection_type, 'Primary'
  FROM (VALUES
    ('pH Meter 01',  'FiveEasy F20', 'Mettler Toledo',       'QC Bench 1'),
    ('pH Meter 02',  'FiveEasy F20', 'Mettler Toledo',       'QC Bench 2'),
    ('Osmometer 01', 'OsmoTECH XT',  'Advanced Instruments', 'QC Bench 1')
  ) AS v(name, model, manufacturer, location)
  WHERE NOT EXISTS (SELECT 1 FROM public.scales s WHERE s.name = v.name);

  -- ── Clean any previous run (idempotent) ──────────────────────────────────
  SELECT array_agg(id) INTO v_old FROM public.production_orders WHERE notes = tag;
  IF v_old IS NOT NULL THEN
    DELETE FROM public.qc_certificates  WHERE production_order_id = ANY(v_old);
    DELETE FROM public.qc_results       WHERE production_order_id = ANY(v_old);
    DELETE FROM public.po_steps         WHERE production_order_id = ANY(v_old);
    DELETE FROM public.production_orders WHERE id = ANY(v_old);
    RAISE NOTICE 'Removed previous run (% orders)', array_length(v_old, 1);
  END IF;

  -- ── Seed per item ─────────────────────────────────────────────────────────
  -- PBS is the headline story: 22 lots / 30 days, final two meter-02 pH
  -- readings out of spec. Tris is supporting data: in spec, mild drift.
  FOR cfg IN
    SELECT * FROM (VALUES
      ('FG-PBS-1X',  22, 30, 2),
      ('FG-TRIS-1M', 10, 30, 0)
    ) AS t(item_number, lot_count, span_days, oos_final)
  LOOP
    SELECT id INTO v_item FROM public.reagent_items WHERE item_number = cfg.item_number;
    IF v_item IS NULL THEN
      RAISE NOTICE 'Skipping %: item not found', cfg.item_number; CONTINUE;
    END IF;

    SELECT id, version, COALESCE(scheduled_minutes, 120) INTO wi_id, wi_ver, wi_min
      FROM public.work_instructions
     WHERE reagent_item_id = v_item AND status = 'approved'
     ORDER BY version DESC NULLS LAST LIMIT 1;
    IF wi_id IS NULL THEN
      RAISE NOTICE 'Skipping %: no approved work instruction', cfg.item_number; CONTINUE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.qc_tests WHERE reagent_item_id = v_item AND is_active) THEN
      RAISE NOTICE 'Skipping %: no QC tests defined', cfg.item_number; CONTINUE;
    END IF;

    -- OOS lots = the LAST cfg.oos_final odd indexes (odd index → meter 02).
    oos_arr := '{}';
    k := cfg.lot_count - 1;
    WHILE k >= 0 AND COALESCE(array_length(oos_arr, 1), 0) < cfg.oos_final LOOP
      IF k % 2 = 1 THEN oos_arr := oos_arr || k; END IF;
      k := k - 1;
    END LOOP;

    FOR i IN 0 .. cfg.lot_count - 1 LOOP
      seq := seq + 1;
      p := CASE WHEN cfg.lot_count > 1 THEN i::numeric / (cfg.lot_count - 1) ELSE 1 END;

      -- Spread lots across the window, ending yesterday; morning starts.
      day_off := round((1 - p) * cfg.span_days)::int + 1;
      v_start := (current_date - day_off) + make_interval(hours => 13 + (seq % 4), mins => (seq * 17) % 60);
      v_end   := v_start + make_interval(mins => wi_min::int);

      t_idx  := seq % n_testers;
      tester := v_testers[1 + t_idx];
      meter  := CASE WHEN i % 2 = 1 THEN 'pH Meter 02' ELSE 'pH Meter 01' END;
      is_oos := i = ANY(oos_arr);
      v_status := CASE WHEN is_oos THEN 'failed' ELSE 'completed' END;

      INSERT INTO public.production_orders
        (work_instruction_id, wi_version, lot_number, batch_size, batch_size_unit,
         notes, status, created_by, assigned_to,
         scheduled_start, scheduled_end, started_at, completed_at, created_at)
      VALUES
        (wi_id, wi_ver,
         'L' || to_char(v_start, 'YYMMDD') || '-Q' || lpad(seq::text, 3, '0'),
         (ARRAY[5, 10, 20])[1 + (seq % 3)], 'L',
         tag, v_status, v_creator, tester,
         v_start, v_end, v_start, v_end, v_start)
      RETURNING id INTO v_order_id;

      -- Completed production steps, spread evenly across the run window.
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
            'ph_notes', 'Adjusted to pH ' || s.tph || '; stable on retest.')
          WHEN 'observe' THEN jsonb_build_object(
            'observation', 'Clear, colorless solution; no visible particulates.')
          ELSE jsonb_build_object('completed', true)
        END,
        tester,
        v_start + (v_end - v_start) * ((s.rn - 1)::float8 / s.cnt),
        v_start + (v_end - v_start) * (s.rn::float8        / s.cnt)
      FROM (
        SELECT
          ws.id, ws.step_order,
          row_number() OVER (ORDER BY ws.step_order) AS rn,
          count(*)     OVER ()                       AS cnt,
          ws.parameters->>'_step_type'               AS stype,
          (random() - 0.5)                           AS r,
          COALESCE((ws.parameters->>'target_weight')::numeric, 100) AS target_w,
          COALESCE(ws.parameters->>'unit', 'g')      AS wunit,
          COALESCE((ws.parameters->>'tolerance_pct')::numeric, 2)     AS tol,
          COALESCE((ws.parameters->>'duration_minutes')::numeric, 10) AS mixmin,
          COALESCE(ws.parameters->>'target_ph', '7.0') AS tph
        FROM public.wi_steps ws
        WHERE ws.work_instruction_id = wi_id
      ) s;

      -- QC results — one per test, spec snapshotted like the app does.
      -- pH: meter 01 flat at target / meter 02 drifting up with p (forced past
      -- USL on the OOS lots). Osmolality: per-tester bias. Others: mid-spec.
      INSERT INTO public.qc_results
        (production_order_id, qc_test_id, test_order, name, unit, result_type,
         lower_limit, upper_limit, target, expected_text, method,
         result_numeric, result_text, passed, instrument, tested_by, tested_at)
      SELECT
        v_order_id, t.id, t.test_order, t.name, t.unit, t.result_type,
        t.lower_limit, t.upper_limit, t.target, t.expected_text, t.method,
        calc.num,
        CASE WHEN t.result_type = 'passfail' THEN 'Pass'
             WHEN t.result_type = 'text'     THEN COALESCE(t.expected_text, 'Conforms')
             ELSE NULL END,
        CASE WHEN t.result_type <> 'numeric' THEN true
             WHEN calc.num IS NULL THEN NULL
             ELSE (t.lower_limit IS NULL OR calc.num >= t.lower_limit)
              AND (t.upper_limit IS NULL OR calc.num <= t.upper_limit) END,
        CASE WHEN t.result_type = 'numeric' AND t.name ILIKE 'pH%'          THEN meter
             WHEN t.result_type = 'numeric' AND t.name ILIKE '%osmolality%' THEN 'Osmometer 01'
             ELSE NULL END,
        tester,
        v_end + INTERVAL '25 minutes'
      FROM public.qc_tests t
      CROSS JOIN LATERAL (
        SELECT CASE
          WHEN t.result_type <> 'numeric' THEN NULL
          WHEN t.name ILIKE 'pH%' THEN
            CASE
              WHEN is_oos THEN
                round((t.upper_limit + (t.upper_limit - t.lower_limit) * (0.05 + random() * 0.1))::numeric, 2)
              WHEN meter = 'pH Meter 02' THEN
                -- climbs to +0.35·span above target: toward USL, never past it
                round((COALESCE(t.target, (t.lower_limit + t.upper_limit) / 2)
                       + (t.upper_limit - t.lower_limit) * 0.35 * p
                       + (random() - 0.5) * 2 * (t.upper_limit - t.lower_limit) * 0.06)::numeric, 2)
              ELSE
                round((COALESCE(t.target, (t.lower_limit + t.upper_limit) / 2)
                       - (t.upper_limit - t.lower_limit) * 0.05
                       + (random() - 0.5) * 2 * (t.upper_limit - t.lower_limit) * 0.12)::numeric, 2)
            END
          WHEN t.name ILIKE '%osmolality%' THEN
            round((COALESCE(t.target, (t.lower_limit + t.upper_limit) / 2)
                   + v_bias[1 + (t_idx % array_length(v_bias, 1))] * ((t.upper_limit - t.lower_limit) / 50)
                   + (random() - 0.5) * 2 * (t.upper_limit - t.lower_limit) * 0.12)::numeric, 0)
          WHEN t.lower_limit IS NOT NULL AND t.upper_limit IS NOT NULL THEN
            round(((t.lower_limit + t.upper_limit) / 2
                   + (random() - 0.5) * 2 * (t.upper_limit - t.lower_limit) * 0.2)::numeric, 2)
          WHEN t.target IS NOT NULL THEN
            round((t.target * (1 + (random() - 0.5) * 0.04))::numeric, 2)
          ELSE NULL
        END AS num
      ) calc
      WHERE t.reagent_item_id = v_item AND t.is_active;

      -- Passing lots get a released COA, like the app issues after QC.
      IF v_status = 'completed' THEN
        INSERT INTO public.qc_certificates (production_order_id, cert_type, issued_by, issued_at)
        VALUES (v_order_id, 'COA', tester, v_end + INTERVAL '45 minutes');
      END IF;
    END LOOP;

    RAISE NOTICE 'Seeded % lots for % (% out of spec)',
      cfg.lot_count, cfg.item_number, cfg.oos_final;
  END LOOP;

  RAISE NOTICE 'Seed complete: % orders tagged %', seq, tag;
END $$;

-- ── Verification ──────────────────────────────────────────────────────────────
-- Lots per item and status:
SELECT ri.item_number, po.status, count(*) AS lots,
       min(po.completed_at)::date AS first_day, max(po.completed_at)::date AS last_day
  FROM public.production_orders po
  JOIN public.work_instructions wi ON wi.id = po.work_instruction_id
  JOIN public.reagent_items     ri ON ri.id = wi.reagent_item_id
 WHERE po.notes = 'DEMO-SEED-QT'
 GROUP BY ri.item_number, po.status
 ORDER BY ri.item_number, po.status;

-- The instrument story: pH readings per meter (meter 02 should trend high,
-- with 2 failing points):
SELECT qr.instrument,
       count(*)                                   AS readings,
       round(avg(qr.result_numeric), 3)           AS mean,
       round(max(qr.result_numeric), 2)           AS max,
       count(*) FILTER (WHERE qr.passed = false)  AS out_of_spec
  FROM public.qc_results qr
  JOIN public.production_orders po ON po.id = qr.production_order_id
 WHERE po.notes = 'DEMO-SEED-QT' AND qr.name ILIKE 'pH%'
 GROUP BY qr.instrument
 ORDER BY qr.instrument;

-- The user story: testers and their Osmolality means:
SELECT pr.full_name,
       count(*)                          AS readings,
       round(avg(qr.result_numeric), 1)  AS mean_osmolality
  FROM public.qc_results qr
  JOIN public.production_orders po ON po.id = qr.production_order_id
  JOIN public.profiles          pr ON pr.id = qr.tested_by
 WHERE po.notes = 'DEMO-SEED-QT' AND qr.name ILIKE '%osmolality%'
 GROUP BY pr.full_name
 ORDER BY pr.full_name;
