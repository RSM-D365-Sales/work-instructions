-- ─────────────────────────────────────────────────────────────────
-- 023_d365_prod_sync.sql
--
-- Allows production orders to be created from D365 F&SC via the
-- `ingest-d365-prod-order` edge function (driven by Power Automate
-- on ProdTable create). Adds a unique D365 ProdId column so the
-- same D365 production order can never be ingested twice.
-- ─────────────────────────────────────────────────────────────────

alter table public.production_orders
  add column if not exists d365_prod_id text;

-- Unique when present; allows multiple manually-created orders
-- (which have NULL) without conflict.
create unique index if not exists production_orders_d365_prod_id_uidx
  on public.production_orders (d365_prod_id)
  where d365_prod_id is not null;
