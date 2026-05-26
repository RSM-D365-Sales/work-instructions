-- ============================================================
-- Migration 019: Reagent Orders → D365 Transfer Order integration
--   * Adds tracking columns to reagent_orders for D365 transfer order
--   * Adds reagent_source_warehouse_id to d365_config (the "REAGENT" lab
--     warehouse id that all transfer orders ship FROM)
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1) Track transfer order on each reagent_order ----------------------
ALTER TABLE public.reagent_orders
  ADD COLUMN IF NOT EXISTS transfer_order_number     text,
  ADD COLUMN IF NOT EXISTS transfer_order_status     text
      CHECK (transfer_order_status IN ('pending','created','failed','skipped')),
  ADD COLUMN IF NOT EXISTS transfer_order_error      text,
  ADD COLUMN IF NOT EXISTS transfer_order_created_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_reagent_orders_to_number
  ON public.reagent_orders (transfer_order_number);

-- 2) Source warehouse on d365_config ---------------------------------
-- The warehouse id (D365 InventLocationId) of the central REAGENT lab
-- that all transfer orders ship FROM. Defaults to 'REAGENT'.
ALTER TABLE public.d365_config
  ADD COLUMN IF NOT EXISTS reagent_source_warehouse_id text NOT NULL DEFAULT 'REAGENT';

COMMENT ON COLUMN public.d365_config.reagent_source_warehouse_id IS
  'D365 InventLocationId of the central REAGENT production lab — all transfer orders ship FROM this warehouse.';
