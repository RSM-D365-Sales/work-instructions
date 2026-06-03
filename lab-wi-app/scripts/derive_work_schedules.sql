-- ============================================================
-- Derive weekly working patterns from already-scheduled orders
-- ------------------------------------------------------------
--   For every person who has production orders scheduled to them, set
--   profiles.work_schedule = a 7-element array (0=Sun..6=Sat):
--     'work' on weekdays they actually have a scheduled run, 'off' otherwise.
--   Weekday is read in America/Denver (matches the seed's local times).
--   A light demo flourish then marks one off-day as 'pto' for ~1 in 3 people
--   so the "time off" colour shows on the gantt / user page.
--   Idempotent. Run after the production-orders seed, then migration 037.
-- ============================================================

-- 1) work / off from the days each person is actually scheduled.
WITH worked AS (
  SELECT assigned_to AS pid,
         array_agg(DISTINCT extract(dow FROM (scheduled_start AT TIME ZONE 'America/Denver'))::int) AS dows
    FROM public.production_orders
   WHERE assigned_to IS NOT NULL
     AND scheduled_start IS NOT NULL
     AND status <> 'cancelled'
   GROUP BY assigned_to
)
UPDATE public.profiles p
   SET work_schedule = (
     SELECT jsonb_agg(CASE WHEN d = ANY(w.dows) THEN 'work' ELSE 'off' END ORDER BY d)
       FROM generate_series(0, 6) AS d
   )
  FROM worked w
 WHERE p.id = w.pid;

-- 2) Optional demo flourish: flip the first off-day to 'pto' for ~1/3 of people
--    (so the emerald "time off" state appears). Comment out for pure work/off.
UPDATE public.profiles p
   SET work_schedule = jsonb_set(p.work_schedule, ARRAY[(s.off_idx - 1)::text], '"pto"'::jsonb)
  FROM (
    SELECT p2.id AS pid,
           (SELECT min(idx)
              FROM jsonb_array_elements_text(p2.work_schedule) WITH ORDINALITY AS t(val, idx)
             WHERE t.val = 'off') AS off_idx
      FROM public.profiles p2
     WHERE p2.work_schedule IS NOT NULL
  ) s
 WHERE p.id = s.pid
   AND s.off_idx IS NOT NULL
   AND random() < 0.34;

-- Verify (week column: WORK=capital letter, pto=lowercase, off=·):
SELECT full_name,
       (SELECT string_agg(
                 CASE val WHEN 'work' THEN substr('SMTWTFS', ord::int, 1)
                          WHEN 'pto'  THEN lower(substr('SMTWTFS', ord::int, 1))
                          ELSE '·' END, '' ORDER BY ord)
          FROM jsonb_array_elements_text(work_schedule) WITH ORDINALITY t(val, ord)) AS week,
       work_schedule
  FROM public.profiles
 WHERE work_schedule IS NOT NULL
 ORDER BY full_name;
