-- ============================================================
-- DEMO POLISH: scatter flat QC results so Quality Trends reads like real data
-- ------------------------------------------------------------
--   The close-out script backfills every numeric QC result at exactly its
--   target (or spec midpoint), which plots as a dead-flat line. This script
--   re-scatters those readings inside spec, adds a gentle lot-to-lot drift,
--   and fills the instrument so the by-instrument pivot has something to
--   compare.
--
--   SCOPE — a numeric result is re-scattered only if it is BOTH:
--     • flat: written by the close-out script, or sitting exactly on its
--       target / spec midpoint, AND
--     • not part of the curated B4 story (orders tagged 'DEMO-SEED-QT'),
--       whose meter-02 drift and two out-of-spec lots are deliberate.
--   Rows with no target and no limits are skipped — there is no scale to
--   scatter them on. The verification query at the bottom lists them.
--
--   EVERY VALUE STAYS IN SPEC (passed = true). Nothing here invents a
--   failure — see the note at the end if you want one for the story.
--
--   tested_by is left alone: the close-out already attributes each result to
--   that order's assignee, so the by-user pivot has real variance.
--
--   Idempotent-ish: re-running re-scatters the same rows to the SAME values
--   (setseed) — but only rows still sitting flat are in scope, so a second
--   run is effectively a no-op. Run in the Supabase SQL Editor.
-- ============================================================

-- Deterministic randomness across re-runs (same convention as
-- seed_quality_trends.sql).
SELECT setseed(0.42);


-- ── 1. Instruments the by-instrument pivot matches on ───────
-- Same three rows seed_quality_trends.sql registers; inserted here too so
-- this script stands alone if that seed was never run.
INSERT INTO public.scales (name, model, manufacturer, location, status, notes,
                           conn_a_type, conn_a_label)
SELECT v.name, v.model, v.manufacturer, v.location,
       'active'::public.scale_status,
       'Seeded for the quality-trends demo',
       'http_rest'::public.scale_connection_type, 'Primary'
  FROM (VALUES
    ('pH Meter 01',  'FiveEasy F20', 'Mettler Toledo',       'QC Bench 1'),
    ('pH Meter 02',  'FiveEasy F20', 'Mettler Toledo',       'QC Bench 2'),
    ('Osmometer 01', 'OsmoTECH XT',  'Advanced Instruments', 'QC Bench 1')
  ) AS v(name, model, manufacturer, location)
 WHERE NOT EXISTS (SELECT 1 FROM public.scales s WHERE s.name = v.name);


-- ── 2. Re-scatter the flat readings ─────────────────────────
-- value = centre + drift + noise, where
--   centre = target, else the spec midpoint
--   drift  = ±6% of the spec span, walking across the lots in date order
--            (a slow trend reads as a real process; pure noise does not)
--   noise  = ±10% of the spec span, per reading
-- Worst case lands 16% of the span off centre — comfortably inside limits.
-- Rounding follows the span: wide specs (osmolality) go integer, tight ones
-- (pH) keep 2 decimals.
WITH scope AS (
  SELECT r.id,
         r.name, r.lower_limit, r.upper_limit, r.target,
         po.completed_at,
         (r.upper_limit - r.lower_limit)                          AS span,
         COALESCE(r.target, (r.lower_limit + r.upper_limit) / 2)  AS centre,
         row_number() OVER (PARTITION BY wi.reagent_item_id, r.name
                                ORDER BY po.completed_at, po.id)  AS rn,
         count(*)     OVER (PARTITION BY wi.reagent_item_id, r.name) AS cnt
    FROM public.qc_results       r
    JOIN public.production_orders po ON po.id = r.production_order_id
    JOIN public.work_instructions wi ON wi.id = po.work_instruction_id
   WHERE r.result_type = 'numeric'
     AND po.notes IS DISTINCT FROM 'DEMO-SEED-QT'      -- keep the curated story
     AND (r.target IS NOT NULL
          OR (r.lower_limit IS NOT NULL AND r.upper_limit IS NOT NULL))
     AND (   r.comment = 'Backfilled by close-out script 2026-07-21'
          OR r.result_numeric = COALESCE(r.target,
                                         (r.lower_limit + r.upper_limit) / 2))
),
calc AS (
  SELECT s.*,
         CASE
           -- Both limits known → scatter across the spec span.
           WHEN s.span IS NOT NULL AND s.span > 0 THEN
             round((s.centre
                    + s.span * 0.12 * (((s.rn - 1)::numeric
                                        / GREATEST(s.cnt - 1, 1)) - 0.5)
                    + s.span * 0.20 * (random() - 0.5))::numeric,
                   CASE WHEN s.span >= 20 THEN 0
                        WHEN s.span >= 2  THEN 1
                        ELSE 2 END)
           -- Target only, no limits → ±2% around the target.
           ELSE round((s.centre * (1 + (random() - 0.5) * 0.04))::numeric, 2)
         END AS new_value
    FROM scope s
)
UPDATE public.qc_results r
   SET result_numeric = c.new_value,
       passed = (r.lower_limit IS NULL OR c.new_value >= r.lower_limit)
            AND (r.upper_limit IS NULL OR c.new_value <= r.upper_limit),
       instrument = COALESCE(r.instrument,
         CASE WHEN r.name ILIKE 'pH%' THEN
                   CASE WHEN c.rn % 2 = 1 THEN 'pH Meter 01' ELSE 'pH Meter 02' END
              WHEN r.name ILIKE '%osmolality%' THEN 'Osmometer 01'
              ELSE NULL END),
       -- Spread testing times off the batch completion instead of stacking
       -- every result at the moment the close-out ran.
       tested_at = COALESCE(LEAST(c.completed_at + INTERVAL '25 minutes', now()),
                            r.tested_at)
  FROM calc c
 WHERE r.id = c.id;


-- ────────────────────────────────────────────────────────────
-- VERIFY
-- ────────────────────────────────────────────────────────────

-- A) Spread per test — min/mean/max should now differ, out_of_spec = 0.
SELECT ri.item_number,
       qr.name                                  AS test,
       count(*)                                 AS readings,
       min(qr.result_numeric)                   AS min,
       round(avg(qr.result_numeric), 3)         AS mean,
       max(qr.result_numeric)                   AS max,
       min(qr.lower_limit) || ' – ' || min(qr.upper_limit) AS spec,
       count(*) FILTER (WHERE qr.passed IS NOT true)       AS out_of_spec
  FROM public.qc_results        qr
  JOIN public.production_orders po ON po.id = qr.production_order_id
  JOIN public.work_instructions wi ON wi.id = po.work_instruction_id
  JOIN public.reagent_items     ri ON ri.id = wi.reagent_item_id
 WHERE qr.result_type = 'numeric'
   AND po.notes IS DISTINCT FROM 'DEMO-SEED-QT'
 GROUP BY ri.item_number, qr.name
 ORDER BY ri.item_number, qr.name;

-- B) Anything still un-scatterable: numeric specs with no target AND no
--    limits (the close-out wrote 0 for these). Give them a spec on the
--    Reagent Items → QC panel, or leave them off the demo path.
SELECT ri.item_number, qr.name AS test, count(*) AS rows_at_zero
  FROM public.qc_results        qr
  JOIN public.production_orders po ON po.id = qr.production_order_id
  JOIN public.work_instructions wi ON wi.id = po.work_instruction_id
  JOIN public.reagent_items     ri ON ri.id = wi.reagent_item_id
 WHERE qr.result_type = 'numeric'
   AND qr.target IS NULL AND qr.lower_limit IS NULL AND qr.upper_limit IS NULL
 GROUP BY ri.item_number, qr.name
 ORDER BY ri.item_number, qr.name;


-- ────────────────────────────────────────────────────────────
-- OPTIONAL — want a drifting instrument story on these lots too?
-- The curated version already exists for FG-PBS-1X in
-- seed_quality_trends.sql (pH Meter 02 climbing toward the upper limit, the
-- last two lots out of spec, ready to "Flag for calibration"). Prefer running
-- that seed over inventing a second drift here — two competing stories on one
-- chart reads as noise on stage.
-- ============================================================
