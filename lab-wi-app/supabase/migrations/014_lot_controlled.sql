-- Migration 014: Add lot_controlled flag to reagent_items
-- When true, operators must record a lot/batch number whenever this reagent
-- is used in a weigh or gather_reagents step during production execution.

ALTER TABLE public.reagent_items
  ADD COLUMN IF NOT EXISTS lot_controlled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.reagent_items.lot_controlled IS
  'When true, the operator must enter a lot/batch number during production execution';
