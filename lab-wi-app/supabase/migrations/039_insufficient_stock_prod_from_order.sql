-- Migration 039: Insufficient-stock flag on reagent orders + production-order
-- creation from a reagent order (incl. D365 OData create tracking).
--
-- "Insufficient stock" is a demo flag set when the reagent order is created
-- (a checkbox on the New Order form), NOT a calculation against on-hand
-- inventory. Admins/approvers (planners) see flagged orders on a dashboard
-- tile and can create a production order straight from the order, which calls
-- the create-d365-production-order edge function to create a basic production
-- order in D365 (item, date, warehouse = REAGENT, site = 3).

-- 1) Demo flag on reagent orders.
alter table public.reagent_orders
  add column if not exists insufficient_stock boolean not null default false;

-- Quick lookup of flagged, still-open orders for the dashboard tile.
create index if not exists reagent_orders_insufficient_stock_idx
  on public.reagent_orders (insufficient_stock)
  where insufficient_stock = true;

-- 2) Trace a production order back to the reagent order it was raised from,
--    and track the D365 OData create call (separate from the existing
--    d365_start_* columns, which track ProdProductionOrderStart).
alter table public.production_orders
  add column if not exists source_reagent_order_id uuid
    references public.reagent_orders(id) on delete set null;

alter table public.production_orders
  add column if not exists d365_create_status text
    check (d365_create_status in ('pending','sent','failed','skipped'));

alter table public.production_orders
  add column if not exists d365_create_error text;
