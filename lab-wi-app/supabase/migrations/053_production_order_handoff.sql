-- Migration 053: Production-order hand-off ("send it back")
-- ---------------------------------------------------------------------------
-- A run can already be assigned to someone (production_orders.assigned_to). This
-- adds one column so a mid-run hand-off can be *returned*: when person A hands an
-- in-progress order to person B, we remember A in previous_assigned_to; B can
-- then "Send back" and the order returns to A. The swap is symmetric, so it can
-- bounce back and forth. No status change — the order keeps running; only who
-- owns it changes.

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS previous_assigned_to uuid REFERENCES public.profiles(id);

COMMENT ON COLUMN public.production_orders.previous_assigned_to IS
  'Who held this order before the last hand-off; the target of a "Send back".';
