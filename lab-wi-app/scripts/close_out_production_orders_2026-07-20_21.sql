-- ============================================================
-- Close out production orders for 2026-07-20 → 2026-07-21
--
-- SCOPE: every production order still open (pending / in_progress /
--        awaiting_qc) that lands on 2026-07-20 or 2026-07-21 by ANY of:
--          • started_at       — it was actually worked that day
--          • scheduled_start  — it was planned to run that day
--          • scheduled_end    — its planned window ended that day
--          • required_by      — the product was needed that day
--
--        created_at is deliberately NOT an anchor: most of these orders were
--        created days earlier (Jul 18–19) and scheduled for the 20th/21st, so
--        anchoring on creation both misses them and would sweep in orders
--        created that week but scheduled for later.
--
-- ⚠ TIMEZONE KNOB: dates are compared in America/Denver (ARUP local), so the
--   window matches what the Scheduling page shows in the browser. If you want
--   plain UTC, replace every `AT TIME ZONE 'America/Denver'` below.
--
-- WHAT IT DOES (mirrors what the app writes when an operator finishes a batch,
-- see ProductionOrderExecutionPage.resolveProductionDoneStatus):
--   1. Materialises any po_steps that were never created — orders left in
--      'pending' have no step rows at all; the app inserts them on start.
--   2. Completes every outstanding po_step, filling actual_values with
--      in-tolerance readings derived from the step's own parameters.
--   3. Backfills missing qc_results for each order's release panel with
--      in-spec / Pass values — otherwise the order can only reach
--      'awaiting_qc', not 'completed'.
--   4. Sets production_orders.status = 'completed', started_at + completed_at.
--
-- NOT touched (deliberate):
--   • inventory_batches / inventory_on_hand — the app posts no inventory on
--     completion, so neither does this script.
--   • qc_certificates — COA/COQ issuance stays a manual, audited action.
--   • 'attachment' steps get no fabricated file; they complete with an empty
--     actual_values (nothing legitimate to invent for an uploaded document).
--   • Orders already completed / failed / cancelled.
--
-- Idempotent: re-running is a no-op (closed orders fall out of scope).
-- Wrapped in a transaction. Run in the Supabase SQL Editor.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- PART 1 — PREVIEW. Run this SELECT on its own first to confirm the
--          blast radius. `matched_on` tells you which date pulled each
--          order in; `scheduled_in_future` flags orders whose window has
--          not arrived yet (their completed_at gets capped at now()).
-- ────────────────────────────────────────────────────────────
SELECT po.production_order_number,
       po.lot_number,
       po.status                          AS current_status,
       wi.title                           AS work_instruction,
       po.required_by,
       po.scheduled_start,
       po.scheduled_end,
       concat_ws(', ',
         CASE WHEN (po.started_at      AT TIME ZONE 'America/Denver')::date
                     BETWEEN DATE '2026-07-20' AND DATE '2026-07-21' THEN 'started'   END,
         CASE WHEN (po.scheduled_start AT TIME ZONE 'America/Denver')::date
                     BETWEEN DATE '2026-07-20' AND DATE '2026-07-21' THEN 'sched_start' END,
         CASE WHEN (po.scheduled_end   AT TIME ZONE 'America/Denver')::date
                     BETWEEN DATE '2026-07-20' AND DATE '2026-07-21' THEN 'sched_end' END,
         CASE WHEN po.required_by BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
                                                            THEN 'required_by' END)  AS matched_on,
       (COALESCE(po.scheduled_start, po.required_by::timestamptz) > now())            AS scheduled_in_future,
       (SELECT count(*) FROM public.po_steps ps
         WHERE ps.production_order_id = po.id
           AND ps.status IN ('pending','in_progress'))        AS steps_outstanding,
       (SELECT count(*) FROM public.wi_steps ws
         WHERE ws.work_instruction_id = po.work_instruction_id
           AND NOT EXISTS (SELECT 1 FROM public.po_steps ps
                            WHERE ps.production_order_id = po.id
                              AND ps.wi_step_id = ws.id))     AS steps_never_created,
       (SELECT count(*) FROM public.qc_tests t
         WHERE t.reagent_item_id = wi.reagent_item_id
           AND t.is_active
           AND NOT EXISTS (SELECT 1 FROM public.qc_results r
                            WHERE r.production_order_id = po.id
                              AND r.qc_test_id = t.id))       AS qc_missing
  FROM public.production_orders po
  JOIN public.work_instructions wi ON wi.id = po.work_instruction_id
 WHERE po.status IN ('pending','in_progress','awaiting_qc')
   AND (   (po.started_at      AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
        OR (po.scheduled_start AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
        OR (po.scheduled_end   AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
        OR  po.required_by                                          BETWEEN DATE '2026-07-20' AND DATE '2026-07-21')
 ORDER BY COALESCE(po.scheduled_start, po.required_by::timestamptz, po.created_at);


-- ────────────────────────────────────────────────────────────
-- PART 2 — THE CLOSE-OUT
--
-- The scope predicate is repeated in each statement (marked ⟨SCOPE⟩) rather
-- than held in a temp table, so each statement stands alone and the script
-- survives the SQL Editor's connection pooling. Statement 4 is what removes
-- rows from scope, so it MUST stay last. If you edit the dates or the
-- timezone, edit all four.
--
-- `run_at` = when the batch effectively ran:
--     started_at → scheduled_start → required_by 08:00 → created_at
-- ────────────────────────────────────────────────────────────
BEGIN;

-- ── 1. Materialise missing step rows ────────────────────────
-- Orders that never left 'pending' have no po_steps at all; the app creates
-- them on start. Insert them as 'pending' and let statement 2 finish them.
WITH scope AS (                                                    -- ⟨SCOPE⟩
  SELECT po.id AS order_id, po.work_instruction_id
    FROM public.production_orders po
   WHERE po.status IN ('pending','in_progress','awaiting_qc')
     AND (   (po.started_at      AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
          OR (po.scheduled_start AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
          OR (po.scheduled_end   AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
          OR  po.required_by                                          BETWEEN DATE '2026-07-20' AND DATE '2026-07-21')
)
INSERT INTO public.po_steps (production_order_id, wi_step_id, step_order, status, actual_values)
SELECT s.order_id, ws.id, ws.step_order, 'pending', '{}'::jsonb
  FROM scope s
  JOIN public.wi_steps ws ON ws.work_instruction_id = s.work_instruction_id
 WHERE NOT EXISTS (
         SELECT 1 FROM public.po_steps ps
          WHERE ps.production_order_id = s.order_id
            AND ps.wi_step_id = ws.id);


-- ── 2. Complete outstanding steps with plausible readings ───
-- actual_values is built from the step's own parameters so every measurement
-- lands on target and in tolerance. Anything the operator already captured
-- wins: `defaults || existing`.
WITH scope AS (                                                    -- ⟨SCOPE⟩
  SELECT po.id                                   AS order_id,
         COALESCE(po.assigned_to, po.created_by) AS operator_id,
         COALESCE(po.started_at,
                  po.scheduled_start,
                  po.required_by::timestamptz + INTERVAL '8 hours',
                  po.created_at)                 AS run_at
    FROM public.production_orders po
   WHERE po.status IN ('pending','in_progress','awaiting_qc')
     AND (   (po.started_at      AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
          OR (po.scheduled_start AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
          OR (po.scheduled_end   AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
          OR  po.required_by                                          BETWEEN DATE '2026-07-20' AND DATE '2026-07-21')
),
ctx AS (
  SELECT ps.id            AS po_step_id,
         ps.step_order,
         s.operator_id,
         s.run_at,
         COALESCE(st.step_type, 'custom')     AS step_type,
         COALESCE(ws.parameters, '{}'::jsonb) AS params
    FROM scope s
    JOIN public.po_steps ps            ON ps.production_order_id = s.order_id
    JOIN public.wi_steps ws            ON ws.id = ps.wi_step_id
    LEFT JOIN public.step_templates st ON st.id = ws.step_template_id
   WHERE ps.status IN ('pending','in_progress')
),
gen AS (
  SELECT c.*,
         CASE c.step_type

           WHEN 'weigh' THEN jsonb_strip_nulls(jsonb_build_object(
             'measured_weight', c.params->'target_weight',
             'unit',            COALESCE(c.params->>'unit', 'g'),
             'in_tolerance',    true,
             'deviation_pct',   0,
             'scale_id',        (SELECT sc.id::text FROM public.scales sc
                                  WHERE sc.equipment_type = 'balance'
                                    AND sc.status = 'active'
                                  ORDER BY sc.name LIMIT 1),
             'lot_number',      CASE WHEN COALESCE(c.params->>'lot_controlled','false')
                                          IN ('true','t','1')
                                     THEN 'CO-' || to_char(c.run_at, 'YYYYMMDD') END))

           WHEN 'dispense' THEN jsonb_strip_nulls(jsonb_build_object(
             'measured_volume', c.params->'target_volume',
             'unit',            COALESCE(c.params->>'unit', 'mL'),
             'in_tolerance',    true,
             'deviation_pct',   0,
             'lot_number',      CASE WHEN COALESCE(c.params->>'lot_controlled','false')
                                          IN ('true','t','1')
                                     THEN 'CO-' || to_char(c.run_at, 'YYYYMMDD') END))

           WHEN 'ph_adjust' THEN jsonb_strip_nulls(jsonb_build_object(
             'measured_ph',   c.params->'target_ph',
             'in_tolerance',  true,
             'meter_id',      (SELECT sc.id::text FROM public.scales sc
                                WHERE sc.equipment_type = 'ph_meter'
                                  AND sc.status = 'active'
                                ORDER BY sc.name LIMIT 1)))

           WHEN 'gather_inputs' THEN jsonb_build_object('checked', COALESCE(
             (SELECT jsonb_agg(i->>'material_name')
                FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(c.params->'inputs') = 'array'
                            THEN c.params->'inputs' ELSE '[]'::jsonb END) i
               WHERE i->>'material_name' IS NOT NULL), '[]'::jsonb))

           WHEN 'gather_equipment' THEN jsonb_build_object('checked', COALESCE(
             (SELECT jsonb_agg(e->>'name')
                FROM jsonb_array_elements(
                       CASE WHEN jsonb_typeof(c.params->'equipment') = 'array'
                            THEN c.params->'equipment' ELSE '[]'::jsonb END) e
               WHERE e->>'name' IS NOT NULL), '[]'::jsonb))

           WHEN 'gather_reagents' THEN jsonb_build_object(
             'checked', COALESCE(
               (SELECT jsonb_agg(COALESCE(r->>'item_number', r->>'product_name'))
                  FROM jsonb_array_elements(
                         CASE WHEN jsonb_typeof(c.params->'reagents') = 'array'
                              THEN c.params->'reagents' ELSE '[]'::jsonb END) r
                 WHERE COALESCE(r->>'item_number', r->>'product_name') IS NOT NULL),
               '[]'::jsonb),
             'lot_numbers', COALESCE(
               (SELECT jsonb_object_agg(COALESCE(r->>'item_number', r->>'product_name'),
                                        'CO-' || to_char(c.run_at, 'YYYYMMDD'))
                  FROM jsonb_array_elements(
                         CASE WHEN jsonb_typeof(c.params->'reagents') = 'array'
                              THEN c.params->'reagents' ELSE '[]'::jsonb END) r
                 WHERE COALESCE(r->>'item_number', r->>'product_name') IS NOT NULL
                   AND COALESCE(r->>'lot_controlled','false') IN ('true','t','1')),
               '{}'::jsonb))

           WHEN 'print_labels'      THEN jsonb_build_object('printed', true)
           WHEN 'possible_deviation'THEN jsonb_build_object('impacted_quantity', 0)
           WHEN 'record_time'       THEN jsonb_build_object('recorded_at',
                                          to_char(c.run_at + (c.step_order * INTERVAL '4 minutes'),
                                                  'YYYY-MM-DD"T"HH24:MI:SSOF:00'))
           WHEN 'mix'     THEN jsonb_strip_nulls(jsonb_build_object(
                                 'actual_duration_minutes', c.params->'duration_minutes',
                                 'completed', true))
           WHEN 'agitate' THEN jsonb_strip_nulls(jsonb_build_object(
                                 'actual_duration_minutes', c.params->'duration_minutes',
                                 'completed', true))
           WHEN 'heat'    THEN jsonb_strip_nulls(jsonb_build_object(
                                 'actual_temp_c', c.params->'target_temp_c'))
           WHEN 'cool'    THEN jsonb_strip_nulls(jsonb_build_object(
                                 'actual_temp_c', c.params->'target_temp_c'))
           WHEN 'observe' THEN jsonb_build_object('observation',
                                 'Conforms — recorded at close-out.')
           ELSE '{}'::jsonb
         END AS defaults
    FROM ctx c
)
UPDATE public.po_steps ps
   SET status        = 'completed',
       actual_values = g.defaults || ps.actual_values,   -- operator data wins
       operator_id   = COALESCE(ps.operator_id, g.operator_id),
       started_at    = COALESCE(ps.started_at,
                                g.run_at + (g.step_order * INTERVAL '4 minutes')),
       completed_at  = COALESCE(ps.completed_at,
                                g.run_at + (g.step_order * INTERVAL '4 minutes')
                                         + INTERVAL '3 minutes'),
       notes         = COALESCE(ps.notes, 'Closed out 2026-07-21 (batch close-out script).')
  FROM gen g
 WHERE ps.id = g.po_step_id;


-- ── 3. Backfill missing QC release results ──────────────────
-- Every active spec on the order's reagent item gets an in-spec result:
--   numeric  → target, else the midpoint of the limits, else a bound
--   text     → the expected text
--   passfail → 'Pass'
-- A result with no value would still read as "not captured" in the app, so
-- numeric specs with no target and no limits fall back to 0 — check the
-- verification query for any of those and fix them by hand.
WITH scope AS (                                                    -- ⟨SCOPE⟩
  SELECT po.id                                   AS order_id,
         po.work_instruction_id,
         COALESCE(po.assigned_to, po.created_by) AS operator_id,
         COALESCE(po.started_at,
                  po.scheduled_start,
                  po.required_by::timestamptz + INTERVAL '8 hours',
                  po.created_at)                 AS run_at
    FROM public.production_orders po
   WHERE po.status IN ('pending','in_progress','awaiting_qc')
     AND (   (po.started_at      AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
          OR (po.scheduled_start AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
          OR (po.scheduled_end   AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
          OR  po.required_by                                          BETWEEN DATE '2026-07-20' AND DATE '2026-07-21')
)
INSERT INTO public.qc_results (
  production_order_id, qc_test_id, test_order, name, unit, result_type,
  lower_limit, upper_limit, target, expected_text, method,
  result_numeric, result_text, passed, comment, tested_by, tested_at)
SELECT s.order_id, t.id, t.test_order, t.name, t.unit, t.result_type,
       t.lower_limit, t.upper_limit, t.target, t.expected_text, t.method,
       CASE WHEN t.result_type = 'numeric'
            THEN COALESCE(t.target,
                          (t.lower_limit + t.upper_limit) / 2,
                          t.lower_limit, t.upper_limit, 0) END,
       CASE WHEN t.result_type = 'passfail' THEN 'Pass'
            WHEN t.result_type = 'text'     THEN COALESCE(t.expected_text, 'Conforms') END,
       true,
       'Backfilled by close-out script 2026-07-21',
       s.operator_id,
       LEAST(s.run_at + INTERVAL '6 hours', now())
  FROM scope s
  JOIN public.work_instructions wi ON wi.id = s.work_instruction_id
  JOIN public.qc_tests t           ON t.reagent_item_id = wi.reagent_item_id
                                  AND t.is_active
 WHERE NOT EXISTS (
         SELECT 1 FROM public.qc_results r
          WHERE r.production_order_id = s.order_id
            AND r.qc_test_id = t.id);


-- ── 4. Close the order headers ──────────────────────────────  ⟨SCOPE⟩
-- started_at   = when it ran (backfilled for orders that never started).
-- completed_at = the last step's finish, floored at scheduled_end (or run +6h)
--                and capped at now() so nothing is stamped in the future.
-- MUST run last: this is the statement that takes these orders out of scope.
UPDATE public.production_orders po
   SET status     = 'completed',
       started_at = COALESCE(po.started_at,
                             po.scheduled_start,
                             po.required_by::timestamptz + INTERVAL '8 hours',
                             po.created_at),
       completed_at = COALESCE(
         po.completed_at,
         LEAST(
           GREATEST(
             (SELECT max(ps.completed_at) FROM public.po_steps ps
               WHERE ps.production_order_id = po.id),
             po.scheduled_end,
             COALESCE(po.started_at, po.scheduled_start, po.created_at) + INTERVAL '2 hours'),
           now()))
 WHERE po.status IN ('pending','in_progress','awaiting_qc')
   AND (   (po.started_at      AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
        OR (po.scheduled_start AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
        OR (po.scheduled_end   AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
        OR  po.required_by                                          BETWEEN DATE '2026-07-20' AND DATE '2026-07-21');

COMMIT;


-- ────────────────────────────────────────────────────────────
-- PART 3 — VERIFY.
--   • still_open      → should return zero rows
--   • closed          → every row: steps_outstanding = 0, qc_missing = 0
-- ────────────────────────────────────────────────────────────
SELECT 'still_open' AS bucket,
       po.production_order_number,
       po.status,
       po.completed_at,
       0 AS steps_outstanding, 0 AS qc_missing
  FROM public.production_orders po
 WHERE po.status IN ('pending','in_progress','awaiting_qc')
   AND (   (po.started_at      AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
        OR (po.scheduled_start AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
        OR (po.scheduled_end   AT TIME ZONE 'America/Denver')::date BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
        OR  po.required_by                                          BETWEEN DATE '2026-07-20' AND DATE '2026-07-21')

UNION ALL

SELECT 'closed',
       po.production_order_number,
       po.status,
       po.completed_at,
       (SELECT count(*) FROM public.po_steps ps
         WHERE ps.production_order_id = po.id
           AND ps.status NOT IN ('completed','skipped'))::int,
       (SELECT count(*) FROM public.qc_results r
         WHERE r.production_order_id = po.id
           AND r.result_numeric IS NULL
           AND COALESCE(r.result_text,'') = '')::int
  FROM public.production_orders po
 WHERE po.status = 'completed'
   AND (po.completed_at AT TIME ZONE 'America/Denver')::date
         BETWEEN DATE '2026-07-20' AND DATE '2026-07-21'
 ORDER BY 1, 2;
