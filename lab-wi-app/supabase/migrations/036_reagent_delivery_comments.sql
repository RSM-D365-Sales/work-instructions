-- ============================================================
-- Migration 036: Delivery comments on reagent orders
--   Lets REAGENT lab staff leave a free-text note when delivering:
--     * reagent_order_items.delivery_comment — specific to one line
--     * reagent_orders.delivery_comment      — applies to every order
--       in a destination lab's transfer (written to each order in the group)
--   Idempotent. Run in the Supabase SQL Editor (after migration 027).
-- ============================================================

ALTER TABLE public.reagent_order_items
  ADD COLUMN IF NOT EXISTS delivery_comment text;

ALTER TABLE public.reagent_orders
  ADD COLUMN IF NOT EXISTS delivery_comment text;
