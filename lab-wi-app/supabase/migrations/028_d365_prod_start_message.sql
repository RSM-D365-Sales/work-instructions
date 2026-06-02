-- ============================================================
-- Migration 028: D365 "Start production order" message integration
--   * Adds MES message-queue + consumption-rule settings to d365_config
--     for the SysMessageService / SendMessage call.
--   * Adds tracking columns to production_orders so the result of the
--     ProdProductionOrderStart message is recorded.
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1) D365 message settings on d365_config ----------------------------
ALTER TABLE public.d365_config
  ADD COLUMN IF NOT EXISTS mes_message_queue            text NOT NULL DEFAULT 'JmgMES3P',
  ADD COLUMN IF NOT EXISTS prod_start_bom_consumption   text NOT NULL DEFAULT 'Never',
  ADD COLUMN IF NOT EXISTS prod_start_route_consumption text NOT NULL DEFAULT 'Never';

COMMENT ON COLUMN public.d365_config.mes_message_queue IS
  'D365 SysMessage queue id the ProdProductionOrderStart message is posted to (_messageQueue).';

-- 2) Track the start message on each production order -----------------
ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS d365_start_status  text
      CHECK (d365_start_status IN ('pending','sent','failed','skipped')),
  ADD COLUMN IF NOT EXISTS d365_start_error   text,
  ADD COLUMN IF NOT EXISTS d365_start_sent_at timestamptz;
