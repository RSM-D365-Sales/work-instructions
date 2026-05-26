-- ============================================================
-- Migration 020: Reagent Order line items
--   * Adds public.reagent_order_items so a single reagent_order
--     can contain multiple products (one D365 transfer order with
--     multiple lines).
--   * Back-fills existing one-item orders into the new table.
--   * Makes the legacy single-item columns on reagent_orders
--     nullable (kept for backward compatibility; new orders
--     leave them NULL and use reagent_order_items instead).
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1) Line items table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reagent_order_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.reagent_orders(id) ON DELETE CASCADE,
  line_number     integer NOT NULL,
  reagent_item_id uuid NOT NULL REFERENCES public.reagent_items(id) ON DELETE RESTRICT,
  quantity        numeric NOT NULL CHECK (quantity > 0),
  unit            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_reagent_order_items_order
  ON public.reagent_order_items (order_id);

CREATE INDEX IF NOT EXISTS idx_reagent_order_items_reagent
  ON public.reagent_order_items (reagent_item_id);

-- 2) Back-fill from existing single-item orders -----------------------
INSERT INTO public.reagent_order_items (order_id, line_number, reagent_item_id, quantity, unit)
SELECT o.id, 1, o.reagent_item_id, o.quantity, o.unit
  FROM public.reagent_orders o
 WHERE o.reagent_item_id IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM public.reagent_order_items i WHERE i.order_id = o.id
       );

-- 3) Relax legacy single-item columns on the parent table -------------
ALTER TABLE public.reagent_orders
  ALTER COLUMN reagent_item_id DROP NOT NULL,
  ALTER COLUMN quantity        DROP NOT NULL,
  ALTER COLUMN unit            DROP NOT NULL;

-- 4) RLS --------------------------------------------------------------
ALTER TABLE public.reagent_order_items ENABLE ROW LEVEL SECURITY;

-- Admin: full access
DROP POLICY IF EXISTS "roi_admin_all" ON public.reagent_order_items;
CREATE POLICY "roi_admin_all" ON public.reagent_order_items
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Read: mirrors the parent reagent_orders SELECT policies
DROP POLICY IF EXISTS "roi_select" ON public.reagent_order_items;
CREATE POLICY "roi_select" ON public.reagent_order_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.reagent_orders o
       WHERE o.id = reagent_order_items.order_id
         AND (
           public.current_user_role() IN ('author','approver','operator')
           OR (
             public.current_user_role() = 'lab'
             AND o.lab_id IN (
               SELECT default_lab_id FROM public.profiles
                WHERE id = auth.uid() AND default_lab_id IS NOT NULL
             )
           )
         )
    )
  );

-- Insert: any authenticated user that owns the parent order
DROP POLICY IF EXISTS "roi_insert" ON public.reagent_order_items;
CREATE POLICY "roi_insert" ON public.reagent_order_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reagent_orders o
       WHERE o.id = reagent_order_items.order_id
         AND o.created_by = auth.uid()
         AND public.current_user_role() IN ('author','approver','operator','lab')
    )
  );

-- Update / delete: non-lab internal roles only
DROP POLICY IF EXISTS "roi_update" ON public.reagent_order_items;
CREATE POLICY "roi_update" ON public.reagent_order_items
  FOR UPDATE
  USING (public.current_user_role() IN ('author','approver','operator'))
  WITH CHECK (public.current_user_role() IN ('author','approver','operator'));

DROP POLICY IF EXISTS "roi_delete" ON public.reagent_order_items;
CREATE POLICY "roi_delete" ON public.reagent_order_items
  FOR DELETE
  USING (public.current_user_role() IN ('author','approver','operator'));
