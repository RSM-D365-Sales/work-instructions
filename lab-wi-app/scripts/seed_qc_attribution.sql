-- Seed: QC attribution for the B4 demo (OPTIONAL — run in the Supabase SQL Editor)
--
-- Makes the Quality Trends pivots tell their story with the existing demo data:
--   1. Adds two pH meters to the equipment master (scales) so the
--      "by instrument" pivot can match them and the flag-for-calibration
--      action has real records to target.
--   2. Backfills qc_results.instrument on pH tests: the upper half of the
--      readings is attributed to "pH Meter 02", the lower half to
--      "pH Meter 01" — so meter 02 visibly trends toward the upper spec
--      limit (the exact scenario in the B4 brief).
--   3. Spreads qc_results.tested_by across operator/author profiles
--      (deterministic per production order) so the "by user" pivot shows
--      operator-to-operator variance.
--
-- DEMO DATA ONLY: steps 2 and 3 OVERWRITE instrument / tested_by on existing
-- qc_results rows. Never run against a database holding real QC records.

-- ─── 1. pH meters in the equipment master ────────────────────────────────────
INSERT INTO public.scales (name, model, manufacturer, location, status, notes, conn_a_type, conn_a_label)
SELECT 'pH Meter 01', 'FiveEasy F20', 'Mettler Toledo', 'QC Bench 1', 'active',
       'Benchtop pH meter (seeded for the B4 quality-trends demo)', 'http_rest', 'Primary'
WHERE NOT EXISTS (SELECT 1 FROM public.scales WHERE name = 'pH Meter 01');

INSERT INTO public.scales (name, model, manufacturer, location, status, notes, conn_a_type, conn_a_label)
SELECT 'pH Meter 02', 'FiveEasy F20', 'Mettler Toledo', 'QC Bench 2', 'active',
       'Benchtop pH meter (seeded for the B4 quality-trends demo)', 'http_rest', 'Primary'
WHERE NOT EXISTS (SELECT 1 FROM public.scales WHERE name = 'pH Meter 02');

-- ─── 2. Instrument attribution on pH results ─────────────────────────────────
-- Upper half of readings → meter 02 (the one "trending high"), rest → meter 01.
WITH ranked AS (
  SELECT id, ntile(2) OVER (ORDER BY result_numeric) AS half
  FROM public.qc_results
  WHERE lower(name) = 'ph' AND result_numeric IS NOT NULL
)
UPDATE public.qc_results q
SET instrument = CASE WHEN r.half = 2 THEN 'pH Meter 02' ELSE 'pH Meter 01' END
FROM ranked r
WHERE q.id = r.id;

-- ─── 3. Tester attribution across operators ──────────────────────────────────
-- Deterministic per production order (same order → same tester), spread over
-- operator + author profiles.
WITH ops AS (
  SELECT id, row_number() OVER (ORDER BY full_name) - 1 AS rn
  FROM public.profiles
  WHERE role IN ('operator', 'author')
),
cnt AS (SELECT count(*)::int AS c FROM ops)
UPDATE public.qc_results q
SET tested_by = o.id,
    tested_at = COALESCE(q.tested_at, q.created_at)
FROM cnt, ops o
WHERE cnt.c > 0
  AND o.rn = abs(hashtext(q.production_order_id::text)) % cnt.c;
