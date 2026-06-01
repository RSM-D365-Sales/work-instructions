-- ============================================================
-- Migration 027: Reagent order delivery
--   * Removes the 'approved' step from the reagent order lifecycle.
--   * Adds delivery details captured when central REAGENT lab staff
--     deliver ordered items to the requesting (destination) lab:
--       delivered_quantity, from_location, to_location, lot_number, delivered_at
--     on each reagent_order_items line.
--       from_location → scanned source bin at the REAGENT lab
--       to_location   → scanned bin at the destination lab
-- Run in Supabase SQL Editor.
-- ============================================================

-- 0) If an earlier version of this migration created delivered_location,
--    rename it to to_location so existing delivery data is preserved.
DO $$
BEGIN
  IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'reagent_order_items'
           AND column_name = 'delivered_location'
      )
     AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'reagent_order_items'
           AND column_name = 'to_location'
      )
  THEN
    ALTER TABLE public.reagent_order_items RENAME COLUMN delivered_location TO to_location;
  END IF;
END $$;

-- 1) Delivery columns on the line items ------------------------------
ALTER TABLE public.reagent_order_items
  ADD COLUMN IF NOT EXISTS delivered_quantity numeric CHECK (delivered_quantity >= 0),
  ADD COLUMN IF NOT EXISTS from_location text,
  ADD COLUMN IF NOT EXISTS to_location   text,
  ADD COLUMN IF NOT EXISTS lot_number    text,
  ADD COLUMN IF NOT EXISTS delivered_at  timestamptz;

-- 2) Drop the approval step from the status lifecycle ----------------
-- Any existing 'approved' orders revert to 'pending' (they are simply
-- waiting to be delivered).
UPDATE public.reagent_orders SET status = 'pending' WHERE status = 'approved';

ALTER TABLE public.reagent_orders DROP CONSTRAINT IF EXISTS reagent_orders_status_check;
ALTER TABLE public.reagent_orders
  ADD CONSTRAINT reagent_orders_status_check
  CHECK (status IN ('pending','in_progress','fulfilled','cancelled'));
