-- ============================================================
-- Migration 035: "Awaiting QC" production order status
--   Adds an 'awaiting_qc' status between 'in_progress' and 'completed'.
--   A production order moves to 'awaiting_qc' when every production step
--   is finished but the QC release results have not all been captured —
--   so the production team reads as done while the QA/QC team gains
--   visibility that a batch is waiting to be tested. Once all QC results
--   are saved the order advances to 'completed'.
--   Idempotent: safe to re-run. Run in Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.production_orders DROP CONSTRAINT IF EXISTS production_orders_status_check;
ALTER TABLE public.production_orders ADD  CONSTRAINT production_orders_status_check
  CHECK (status IN ('pending','in_progress','awaiting_qc','completed','failed','cancelled'));
