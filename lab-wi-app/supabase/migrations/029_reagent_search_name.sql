-- ============================================================
-- Migration 029: Reagent item Search Name
--   * Adds search_name to reagent_items (the D365 ProductSearchName).
--   * Moves the current product_name value into search_name so product_name
--     can be re-typed with a clean, human-friendly name for the demo.
-- Run in Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.reagent_items
  ADD COLUMN IF NOT EXISTS search_name text;

COMMENT ON COLUMN public.reagent_items.search_name IS
  'D365 ProductSearchName — the raw/short identifier. product_name holds the friendly display name.';

-- Backfill: copy the existing product_name into search_name where empty.
UPDATE public.reagent_items
   SET search_name = product_name
 WHERE search_name IS NULL;
