-- ============================================================
-- DEMO SEED: equipment drift — one instrument per health status
-- ------------------------------------------------------------
--   Feeds the "Equipment health" panel (Quality Trends + Equipment pages) so
--   it shows all four states rather than a wall of "In control":
--
--     pH Meter 03   → TRENDING     walks from 15% to 70% of the way to its
--                                  limit over 10 lots. EVERY reading passes —
--                                  this is the leading indicator the
--                                  out-of-spec count cannot see.
--     Osmometer 02  → NEAR LIMIT   parks at ~78% of the way to the limit and
--                                  stays there. Still passing, but no margin.
--     pH Meter 04   → OUT OF SPEC  steady mid-spec, then the last two lots
--                                  cross the limit and fail.
--     Osmometer 01  → IN CONTROL   scattered around the centre, for contrast.
--
--   "Drift %" = how far a reading sits from the centre of its spec, as a
--   share of the half-span: 0% = dead centre, 100% = exactly on the limit.
--   The panel averages the last 5 readings and compares them with the 5
--   before, which is why the trending instrument gets 10 lots and the rest 6.
--
--   Attaches to the first finished good that has an approved Work Instruction
--   and a numeric QC test with BOTH limits set (drift needs a span). Each
--   instrument uses the test that best matches it — a pH test for the meters,
--   osmolality for the osmometers — falling back to any bounded numeric test.
--
--   Idempotent: every order is tagged notes = 'DEMO-SEED-DRIFT' and prior
--   tagged rows are removed first, so it is safe to re-run. Cleanup:
--     DELETE FROM public.production_orders WHERE notes = 'DEMO-SEED-DRIFT';
--
--   Independent of seed_quality_trends.sql — different instruments, different
--   tag — so the two can coexist. Run in the Supabase SQL Editor.
-- ============================================================

DO $$
DECLARE
  tag        constant text := 'DEMO-SEED-DRIFT';

  v_testers  uuid[];
  n_testers  int;
  v_creator  uuid;
  tester     uuid;

  v_item     uuid;
  v_item_no  text;
  wi_id      uuid;
  wi_ver     int;
  wi_min     numeric;

  cfg        record;
  v_test     record;
  v_old      uuid[];

  seq        int := 0;
  i          int;
  q          numeric;   -- lot progress 0..1
  pos        numeric;   -- position in spec: 0 = centre, ±1 = on the limit
  lo         numeric;
  hi         numeric;
  centre     numeric;
  half       numeric;
  val        numeric;
  dp         int;
  v_start    timestamptz;
  v_end      timestamptz;
  v_order    uuid;
BEGIN
  PERFORM setseed(0.24);   -- deterministic across re-runs

  -- ── People ───────────────────────────────────────────────────────────────
  SELECT array_agg(id ORDER BY lower(email)) INTO v_testers
    FROM public.profiles WHERE role = 'operator';
  IF v_testers IS NULL THEN
    SELECT array_agg(id ORDER BY lower(email)) INTO v_testers
      FROM public.profiles WHERE role IN ('operator', 'author', 'admin');
  END IF;
  IF v_testers IS NULL THEN
    RAISE EXCEPTION 'No profiles found to attribute tests to.';
  END IF;
  n_testers := array_length(v_testers, 1);

  SELECT id INTO v_creator FROM public.profiles WHERE role = 'admin' ORDER BY created_at LIMIT 1;
  IF v_creator IS NULL THEN v_creator := v_testers[1]; END IF;

  -- ── Equipment master — the panel matches on these names ──────────────────
  INSERT INTO public.scales (name, model, manufacturer, location, status, notes,
                             equipment_type, conn_a_type, conn_a_label)
  SELECT v.name, v.model, v.manufacturer, v.location,
         'active'::public.scale_status,
         'Seeded for the equipment-health demo',
         v.etype,
         'http_rest'::public.scale_connection_type, 'Primary'
  FROM (VALUES
    ('pH Meter 03',  'FiveEasy F20', 'Mettler Toledo',       'QC Bench 3', 'ph_meter'),
    ('pH Meter 04',  'FiveEasy F20', 'Mettler Toledo',       'QC Bench 4', 'ph_meter'),
    ('Osmometer 02', 'OsmoTECH XT',  'Advanced Instruments', 'QC Bench 2', 'osmometer')
  ) AS v(name, model, manufacturer, location, etype)
  WHERE NOT EXISTS (SELECT 1 FROM public.scales s WHERE s.name = v.name);

  -- Osmometer 01 belongs to seed_quality_trends; create it only if absent so
  -- this script stands alone.
  INSERT INTO public.scales (name, model, manufacturer, location, status, notes,
                             equipment_type, conn_a_type, conn_a_label)
  SELECT 'Osmometer 01', 'OsmoTECH XT', 'Advanced Instruments', 'QC Bench 1',
         'active'::public.scale_status, 'Seeded for the equipment-health demo',
         'osmometer', 'http_rest'::public.scale_connection_type, 'Primary'
  WHERE NOT EXISTS (SELECT 1 FROM public.scales s WHERE s.name = 'Osmometer 01');

  -- ── Clean any previous run ───────────────────────────────────────────────
  SELECT array_agg(id) INTO v_old FROM public.production_orders WHERE notes = tag;
  IF v_old IS NOT NULL THEN
    DELETE FROM public.qc_certificates   WHERE production_order_id = ANY(v_old);
    DELETE FROM public.qc_results        WHERE production_order_id = ANY(v_old);
    DELETE FROM public.po_steps          WHERE production_order_id = ANY(v_old);
    DELETE FROM public.production_orders WHERE id = ANY(v_old);
    RAISE NOTICE 'Removed previous run (% orders)', array_length(v_old, 1);
  END IF;

  -- ── Target item: needs an approved WI and a bounded numeric QC test ──────
  SELECT ri.id, ri.item_number, wi.id, wi.version, COALESCE(wi.scheduled_minutes, 120)
    INTO v_item, v_item_no, wi_id, wi_ver, wi_min
    FROM public.reagent_items ri
    JOIN public.work_instructions wi
      ON wi.reagent_item_id = ri.id AND wi.status = 'approved'
   WHERE EXISTS (
           SELECT 1 FROM public.qc_tests t
            WHERE t.reagent_item_id = ri.id AND t.is_active
              AND t.result_type = 'numeric'
              AND t.lower_limit IS NOT NULL AND t.upper_limit IS NOT NULL)
   ORDER BY (ri.item_type = 'FG') DESC, ri.item_number
   LIMIT 1;

  IF v_item IS NULL THEN
    RAISE EXCEPTION 'No item found with an approved Work Instruction and a numeric QC test with both limits. Seed QC specs first (033_seed_qc_specs.sql).';
  END IF;
  RAISE NOTICE 'Seeding drift lots against item %', v_item_no;

  -- ── One instrument per health status ─────────────────────────────────────
  FOR cfg IN
    SELECT * FROM (VALUES
      ('pH Meter 03',  'trending',    10, 'pH%'),
      ('Osmometer 02', 'near_limit',   6, '%osmolality%'),
      ('pH Meter 04',  'out_of_spec',  6, 'pH%'),
      ('Osmometer 01', 'in_control',   6, '%osmolality%')
    ) AS t(instrument, pattern, lots, test_match)
  LOOP
    -- Best-matching bounded numeric test for this instrument.
    SELECT * INTO v_test
      FROM public.qc_tests t
     WHERE t.reagent_item_id = v_item AND t.is_active
       AND t.result_type = 'numeric'
       AND t.lower_limit IS NOT NULL AND t.upper_limit IS NOT NULL
     ORDER BY (t.name ILIKE cfg.test_match) DESC, t.test_order
     LIMIT 1;

    lo     := v_test.lower_limit;
    hi     := v_test.upper_limit;
    centre := (lo + hi) / 2;
    half   := (hi - lo) / 2;
    dp     := CASE WHEN (hi - lo) >= 20 THEN 0 WHEN (hi - lo) >= 2 THEN 1 ELSE 2 END;

    FOR i IN 0 .. cfg.lots - 1 LOOP
      seq := seq + 1;
      q := CASE WHEN cfg.lots > 1 THEN i::numeric / (cfg.lots - 1) ELSE 1 END;

      -- Where this reading sits in the spec (share of the half-span).
      pos := CASE cfg.pattern
        WHEN 'trending'   THEN 0.15 + 0.55 * q + (random() - 0.5) * 0.04
        WHEN 'near_limit' THEN 0.78 + (random() - 0.5) * 0.08
        WHEN 'out_of_spec' THEN
          CASE WHEN i >= cfg.lots - 2 THEN 1.08 + random() * 0.06        -- past the limit
               ELSE 0.45 + (random() - 0.5) * 0.20 END
        ELSE (random() - 0.5) * 0.30                                     -- in control
      END;

      val := round(centre + pos * half, dp);

      -- Lots march forward in time — the trend windows read in tested_at order.
      v_start := (current_date - ((cfg.lots - i) * 3))
                 + make_interval(hours => 9 + (seq % 5), mins => (seq * 13) % 60);
      v_end   := v_start + make_interval(mins => wi_min::int);
      tester  := v_testers[1 + (seq % n_testers)];

      INSERT INTO public.production_orders
        (work_instruction_id, wi_version, lot_number, batch_size, batch_size_unit,
         notes, status, created_by, assigned_to,
         scheduled_start, scheduled_end, started_at, completed_at, created_at)
      VALUES
        (wi_id, wi_ver,
         'L' || to_char(v_start, 'YYMMDD') || '-D' || lpad(seq::text, 3, '0'),
         (ARRAY[5, 10, 20])[1 + (seq % 3)], 'L',
         tag, 'completed', v_creator, tester,
         v_start, v_end, v_start, v_end, v_start)
      RETURNING id INTO v_order;

      -- Completed steps, so the lot opens cleanly if anyone clicks into it.
      INSERT INTO public.po_steps
        (production_order_id, wi_step_id, step_order, status, actual_values,
         operator_id, started_at, completed_at)
      SELECT v_order, ws.id, ws.step_order, 'completed',
             jsonb_build_object('completed', true),
             tester,
             v_start + (v_end - v_start) * ((s.rn - 1)::float8 / s.cnt),
             v_start + (v_end - v_start) * (s.rn::float8       / s.cnt)
        FROM public.wi_steps ws
        JOIN (
          SELECT id,
                 row_number() OVER (ORDER BY step_order) AS rn,
                 count(*)     OVER ()                    AS cnt
            FROM public.wi_steps WHERE work_instruction_id = wi_id
        ) s ON s.id = ws.id
       WHERE ws.work_instruction_id = wi_id;

      -- The reading itself, attributed to this instrument.
      INSERT INTO public.qc_results
        (production_order_id, qc_test_id, test_order, name, unit, result_type,
         lower_limit, upper_limit, target, expected_text, method,
         result_numeric, passed, instrument, tested_by, tested_at)
      VALUES
        (v_order, v_test.id, v_test.test_order, v_test.name, v_test.unit, 'numeric',
         lo, hi, v_test.target, v_test.expected_text, v_test.method,
         val, (val >= lo AND val <= hi), cfg.instrument,
         tester, v_end + INTERVAL '25 minutes');
    END LOOP;

    RAISE NOTICE '  % → % (% lots on test "%")',
      cfg.instrument, cfg.pattern, cfg.lots, v_test.name;
  END LOOP;

  RAISE NOTICE 'Seed complete: % lots tagged %', seq, tag;
END $$;


-- ── Verification: the same maths the Equipment health panel runs ─────────────
-- recent_drift_pct is the mean of the last 5 readings, prior_drift_pct the 5
-- before. Expected:
--   pH Meter 03   recent ≈ 58%, prior ≈ 27%  → Trending   (0 out of spec)
--   Osmometer 02  recent ≈ 78%               → Near limit (0 out of spec)
--   pH Meter 04   2 out of spec              → Out of spec
--   Osmometer 01  recent < 20%               → In control (0 out of spec)
WITH pos AS (
  SELECT qr.instrument, qr.tested_at, qr.passed,
         (qr.result_numeric - (qr.lower_limit + qr.upper_limit) / 2)
           / NULLIF((qr.upper_limit - qr.lower_limit) / 2, 0) AS p
    FROM public.qc_results        qr
    JOIN public.production_orders po ON po.id = qr.production_order_id
   WHERE po.notes = 'DEMO-SEED-DRIFT'
     AND qr.result_numeric IS NOT NULL
),
ranked AS (
  SELECT *, row_number() OVER (PARTITION BY instrument ORDER BY tested_at DESC) AS rn
    FROM pos
)
SELECT instrument,
       count(*)                                                    AS readings,
       count(*) FILTER (WHERE passed IS false)                     AS out_of_spec,
       round(avg(abs(p)) FILTER (WHERE rn <= 5)  * 100)            AS recent_drift_pct,
       round(avg(abs(p)) FILTER (WHERE rn BETWEEN 6 AND 10) * 100) AS prior_drift_pct
  FROM ranked
 GROUP BY instrument
 ORDER BY out_of_spec DESC, recent_drift_pct DESC;
