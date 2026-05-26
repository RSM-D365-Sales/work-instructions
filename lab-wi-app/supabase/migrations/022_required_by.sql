-- ─────────────────────────────────────────────────────────────────
-- 022_required_by.sql
--
-- Adds a "requirement date" to production orders. This is the date
-- the finished product is needed by — separate from scheduled_start
-- (which is the planned start of the run). A production order can be
-- created with a requirement date and have its scheduled_start filled
-- in later by an admin from the Unscheduled Orders page.
-- ─────────────────────────────────────────────────────────────────

alter table public.production_orders
  add column if not exists required_by date;

-- Helps the Unscheduled Orders page sort/filter quickly.
create index if not exists production_orders_required_by_idx
  on public.production_orders (required_by);
