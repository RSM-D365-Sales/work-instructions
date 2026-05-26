-- ─────────────────────────────────────────────────────────────────
-- 021_scheduling.sql
--
-- Adds basic scheduling support:
--   • work_instructions.scheduled_minutes  -- expected duration of a run
--   • production_orders.scheduled_start    -- when the run is planned to start
--   • production_orders.scheduled_end      -- when it is planned to end
--
-- When a Production Order is created against a WI, the UI seeds
-- scheduled_start (defaults to now) and computes scheduled_end as
-- scheduled_start + work_instructions.scheduled_minutes.  These two
-- columns drive the "blocked time" shown on the Production Schedule
-- gantt on the dashboard.
-- ─────────────────────────────────────────────────────────────────

alter table public.work_instructions
  add column if not exists scheduled_minutes integer;

alter table public.production_orders
  add column if not exists scheduled_start timestamptz,
  add column if not exists scheduled_end   timestamptz;

-- Helpful index for the dashboard gantt range query.
create index if not exists production_orders_scheduled_start_idx
  on public.production_orders (scheduled_start);

-- ─────────────────────────────────────────────────────────────────
-- Backfill existing rows with a default 120-minute schedule so the
-- gantt has a consistent baseline. Idempotent — only fills rows
-- where the column is still NULL.
-- ─────────────────────────────────────────────────────────────────

-- 1) Every approved Work Instruction with no scheduled_minutes → 120
update public.work_instructions
   set scheduled_minutes = 120
 where status = 'approved'
   and scheduled_minutes is null;

-- 2) Every Production Order missing a scheduled window:
--      scheduled_start = started_at ?? created_at
--      scheduled_end   = scheduled_start + 120 minutes
update public.production_orders
   set scheduled_start = coalesce(started_at, created_at),
       scheduled_end   = coalesce(started_at, created_at) + interval '120 minutes'
 where scheduled_start is null;
