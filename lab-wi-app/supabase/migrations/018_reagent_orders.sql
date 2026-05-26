-- ============================================================
-- Migration 018: Reagent Orders
--   * Adds 'lab' role to profiles role check constraint
--   * Creates public.reagent_orders table for inter-lab ordering:
--       other labs (Lab1/Lab2/Lab3) order reagent products
--       produced by the central REAGENT lab.
--   * RLS:
--       - admin           : full access
--       - lab role        : can SELECT only orders where lab_id =
--                           their profile.default_lab_id, and can
--                           INSERT new orders
--       - other roles     : (admin/author/approver/operator) full
--                           read + can create/update orders
--   * Auto order_number via sequence  (RO-YYYY-NNNN)
-- Run in Supabase SQL Editor.
-- ============================================================

-- 1) Add 'lab' role to the profiles constraint -----------------------
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'author', 'approver', 'operator', 'lab'));

-- 2) Order-number sequence -------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.reagent_orders_seq START 1;

-- 3) reagent_orders table --------------------------------------------
CREATE TABLE IF NOT EXISTS public.reagent_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number        text NOT NULL UNIQUE
                        DEFAULT ('RO-' || to_char(now(), 'YYYY') || '-' ||
                                 lpad(nextval('public.reagent_orders_seq')::text, 4, '0')),

  reagent_item_id     uuid NOT NULL REFERENCES public.reagent_items(id) ON DELETE RESTRICT,
  quantity            numeric NOT NULL CHECK (quantity > 0),
  unit                text NOT NULL,

  lab_id              uuid NOT NULL REFERENCES public.labs(id) ON DELETE RESTRICT,

  requested_for_date  date NOT NULL,
  notes               text,
  high_priority       boolean NOT NULL DEFAULT false,

  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','approved','in_progress','fulfilled','cancelled')),

  created_by          uuid NOT NULL REFERENCES public.profiles(id),  -- the entry creator
  requested_by        uuid NOT NULL REFERENCES public.profiles(id),  -- on-behalf-of

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reagent_orders_lab     ON public.reagent_orders (lab_id);
CREATE INDEX IF NOT EXISTS idx_reagent_orders_status  ON public.reagent_orders (status);
CREATE INDEX IF NOT EXISTS idx_reagent_orders_priority ON public.reagent_orders (high_priority) WHERE high_priority;
CREATE INDEX IF NOT EXISTS idx_reagent_orders_created ON public.reagent_orders (created_at DESC);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_reagent_orders_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reagent_orders_updated_at ON public.reagent_orders;
CREATE TRIGGER trg_reagent_orders_updated_at
  BEFORE UPDATE ON public.reagent_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_reagent_orders_updated_at();

-- 4) RLS -------------------------------------------------------------
ALTER TABLE public.reagent_orders ENABLE ROW LEVEL SECURITY;

-- Admin: full access
DROP POLICY IF EXISTS "reagent_orders_admin_all" ON public.reagent_orders;
CREATE POLICY "reagent_orders_admin_all" ON public.reagent_orders
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Non-lab authenticated roles (author/approver/operator) : full read + insert + update
DROP POLICY IF EXISTS "reagent_orders_internal_read" ON public.reagent_orders;
CREATE POLICY "reagent_orders_internal_read" ON public.reagent_orders
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND public.current_user_role() IN ('author','approver','operator')
  );

DROP POLICY IF EXISTS "reagent_orders_internal_insert" ON public.reagent_orders;
CREATE POLICY "reagent_orders_internal_insert" ON public.reagent_orders
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.current_user_role() IN ('author','approver','operator')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "reagent_orders_internal_update" ON public.reagent_orders;
CREATE POLICY "reagent_orders_internal_update" ON public.reagent_orders
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND public.current_user_role() IN ('author','approver','operator')
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.current_user_role() IN ('author','approver','operator')
  );

-- Lab role: read only orders for their own lab
DROP POLICY IF EXISTS "reagent_orders_lab_read" ON public.reagent_orders;
CREATE POLICY "reagent_orders_lab_read" ON public.reagent_orders
  FOR SELECT
  USING (
    public.current_user_role() = 'lab'
    AND lab_id IN (
      SELECT default_lab_id FROM public.profiles
       WHERE id = auth.uid() AND default_lab_id IS NOT NULL
    )
  );

-- Lab role: can insert new orders (must be the creator)
DROP POLICY IF EXISTS "reagent_orders_lab_insert" ON public.reagent_orders;
CREATE POLICY "reagent_orders_lab_insert" ON public.reagent_orders
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'lab'
    AND created_by = auth.uid()
  );

-- 5) Make sure existing tables the lab role needs to read are reachable
--    Labs are already readable by any authenticated user (migration 016).
--    Reagent items: ensure SELECT for lab role.
DROP POLICY IF EXISTS "reagent_items_lab_read" ON public.reagent_items;
CREATE POLICY "reagent_items_lab_read" ON public.reagent_items
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND public.current_user_role() = 'lab'
    AND is_active = true
  );

-- Profiles: lab role needs to read its own profile (already covered by
-- existing "Users can read all profiles" policy in migration 002).
