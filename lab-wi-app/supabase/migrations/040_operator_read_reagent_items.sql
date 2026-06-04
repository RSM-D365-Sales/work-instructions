-- Migration 040: Let the operator role READ reagent items.
--
-- Operators can view and deliver reagent orders, but reagent_items had no
-- SELECT policy for them — so the joined item name / number came back NULL and
-- the "Items" column showed blank (quantities, which live on
-- reagent_order_items, still rendered). This grants read-only access to active
-- items, mirroring the existing lab policy. Operators still cannot add or edit
-- items (no INSERT/UPDATE/DELETE policy, and the Reagent Items page stays
-- admin/author only).

DROP POLICY IF EXISTS "reagent_items_operator_read" ON public.reagent_items;
CREATE POLICY "reagent_items_operator_read" ON public.reagent_items
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND public.current_user_role() = 'operator'
    AND is_active = true
  );
