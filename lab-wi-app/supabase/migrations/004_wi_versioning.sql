-- Migration 004: Track WI version on production orders
-- Adds wi_version column to production_orders

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS wi_version integer;

-- Backfill existing orders with the current version of their linked WI
UPDATE public.production_orders po
SET wi_version = wi.version
FROM public.work_instructions wi
WHERE po.work_instruction_id = wi.id
  AND po.wi_version IS NULL;
