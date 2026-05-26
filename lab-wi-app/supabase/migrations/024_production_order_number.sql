-- ─────────────────────────────────────────────────────────────────
-- 024_production_order_number.sql
--
-- Adds a human-facing production order number, kept DISTINCT from
-- lot_number:
--   • D365-ingested orders  → set to the D365 ProdId (e.g. "PM100")
--                             by the ingest-d365-prod-order edge fn.
--   • UI-created orders      → auto-assigned "MAN######" from a
--                             sequence so they are visibly manual.
-- ─────────────────────────────────────────────────────────────────

-- Sequence backing the manual "MAN######" numbers.
create sequence if not exists public.production_order_manual_seq;

-- 1) Add the column nullable first (fast, metadata-only).
alter table public.production_orders
  add column if not exists production_order_number text;

-- 2) Backfill existing rows:
--      prefer the D365 ProdId; otherwise assign a MAN###### number.
update public.production_orders
   set production_order_number = d365_prod_id
 where production_order_number is null
   and d365_prod_id is not null;

update public.production_orders
   set production_order_number =
       'MAN' || lpad(nextval('public.production_order_manual_seq')::text, 6, '0')
 where production_order_number is null;

-- 3) Default for future inserts that OMIT the column (the manual UI path).
--    The D365 edge function always sets the column explicitly, so the
--    default — and therefore the sequence — only advances for manually
--    created orders.
alter table public.production_orders
  alter column production_order_number set default
    ('MAN' || lpad(nextval('public.production_order_manual_seq')::text, 6, '0'));

-- 4) Now that every row has a value, enforce NOT NULL.
alter table public.production_orders
  alter column production_order_number set not null;

-- 5) One production order number per row.
create unique index if not exists production_orders_production_order_number_uidx
  on public.production_orders (production_order_number);
