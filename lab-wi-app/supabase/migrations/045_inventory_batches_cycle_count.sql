-- Migration 045: Batch-level inventory + cycle counting
--
-- Adds the batch (lot) dimension under inventory_on_hand and the tables for
-- per-lab cycle counts:
--   * inventory_batches — on-hand per item / lab / batch number. The batch
--     quantities for an item+lab sum to inventory_on_hand.physical_inventory
--     (seeded by scripts/seed_inventory_batches.sql; kept in sync when a
--     cycle count posts).
--   * cycle_counts / cycle_count_lines — one header per posted count with a
--     line per batch (expected vs counted), so there is an audit trail and a
--     "recent counts" view. Posting adjusts inventory_batches, rolls the new
--     sums up to inventory_on_hand, and stamps d365_synced_at to mimic the
--     future push to D365.
--
-- Access: staff (author / approver / operator) can count any lab; the Lab
-- Scientist ('lab') role can see and count ONLY their own lab's inventory.
-- Run in the Supabase SQL Editor.

-- ─── 1. inventory_batches ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_batches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reagent_item_id     uuid NOT NULL REFERENCES public.reagent_items(id) ON DELETE CASCADE,
  lab_id              uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  batch_number        text NOT NULL,
  quantity            numeric(14,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  received_at         timestamptz,
  expiration_date     date,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reagent_item_id, lab_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_inv_batches_item ON public.inventory_batches (reagent_item_id);
CREATE INDEX IF NOT EXISTS idx_inv_batches_lab  ON public.inventory_batches (lab_id);

CREATE OR REPLACE FUNCTION public.set_inventory_batches_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_batches_updated_at ON public.inventory_batches;
CREATE TRIGGER trg_inventory_batches_updated_at
  BEFORE UPDATE ON public.inventory_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_batches_updated_at();

-- ─── 2. cycle_counts (header) + cycle_count_lines ────────────────────────────
CREATE TABLE IF NOT EXISTS public.cycle_counts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_id              uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  counted_by          uuid REFERENCES public.profiles(id),
  status              text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted')),
  total_lines         integer NOT NULL DEFAULT 0,
  total_variance      numeric(14,2) NOT NULL DEFAULT 0,   -- net counted − expected
  -- Mimics the future push to D365 F&SC (counting journal).
  d365_sync_status    text NOT NULL DEFAULT 'sent' CHECK (d365_sync_status IN ('pending','sent','failed')),
  d365_synced_at      timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cycle_counts_lab ON public.cycle_counts (lab_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cycle_count_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_count_id      uuid NOT NULL REFERENCES public.cycle_counts(id) ON DELETE CASCADE,
  inventory_batch_id  uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  reagent_item_id     uuid NOT NULL REFERENCES public.reagent_items(id) ON DELETE CASCADE,
  batch_number        text NOT NULL,
  expected_quantity   numeric(14,2) NOT NULL,
  counted_quantity    numeric(14,2) NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ccl_count ON public.cycle_count_lines (cycle_count_id);

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_counts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cycle_count_lines ENABLE ROW LEVEL SECURITY;

-- Helper predicate used below: the caller's default lab.
--   (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())

-- inventory_batches: admin + staff full access; lab role scoped to own lab.
DROP POLICY IF EXISTS "inv_batches_admin_all" ON public.inventory_batches;
CREATE POLICY "inv_batches_admin_all" ON public.inventory_batches
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "inv_batches_staff_all" ON public.inventory_batches;
CREATE POLICY "inv_batches_staff_all" ON public.inventory_batches
  FOR ALL
  USING (public.current_user_role() IN ('author','approver','operator'))
  WITH CHECK (public.current_user_role() IN ('author','approver','operator'));

DROP POLICY IF EXISTS "inv_batches_lab_read" ON public.inventory_batches;
CREATE POLICY "inv_batches_lab_read" ON public.inventory_batches
  FOR SELECT
  USING (
    public.current_user_role() = 'lab'
    AND lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "inv_batches_lab_update" ON public.inventory_batches;
CREATE POLICY "inv_batches_lab_update" ON public.inventory_batches
  FOR UPDATE
  USING (
    public.current_user_role() = 'lab'
    AND lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    public.current_user_role() = 'lab'
    AND lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
  );

-- cycle_counts: admin + staff full; lab role reads/creates counts for own lab.
DROP POLICY IF EXISTS "cycle_counts_admin_all" ON public.cycle_counts;
CREATE POLICY "cycle_counts_admin_all" ON public.cycle_counts
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "cycle_counts_staff_all" ON public.cycle_counts;
CREATE POLICY "cycle_counts_staff_all" ON public.cycle_counts
  FOR ALL
  USING (public.current_user_role() IN ('author','approver','operator'))
  WITH CHECK (public.current_user_role() IN ('author','approver','operator'));

DROP POLICY IF EXISTS "cycle_counts_lab_read" ON public.cycle_counts;
CREATE POLICY "cycle_counts_lab_read" ON public.cycle_counts
  FOR SELECT
  USING (
    public.current_user_role() = 'lab'
    AND lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "cycle_counts_lab_insert" ON public.cycle_counts;
CREATE POLICY "cycle_counts_lab_insert" ON public.cycle_counts
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'lab'
    AND lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
    AND counted_by = auth.uid()
  );

-- cycle_count_lines: access follows the parent count.
DROP POLICY IF EXISTS "ccl_admin_all" ON public.cycle_count_lines;
CREATE POLICY "ccl_admin_all" ON public.cycle_count_lines
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "ccl_staff_all" ON public.cycle_count_lines;
CREATE POLICY "ccl_staff_all" ON public.cycle_count_lines
  FOR ALL
  USING (public.current_user_role() IN ('author','approver','operator'))
  WITH CHECK (public.current_user_role() IN ('author','approver','operator'));

DROP POLICY IF EXISTS "ccl_lab_read" ON public.cycle_count_lines;
CREATE POLICY "ccl_lab_read" ON public.cycle_count_lines
  FOR SELECT
  USING (
    public.current_user_role() = 'lab'
    AND EXISTS (
      SELECT 1 FROM public.cycle_counts cc
       WHERE cc.id = cycle_count_lines.cycle_count_id
         AND cc.lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "ccl_lab_insert" ON public.cycle_count_lines;
CREATE POLICY "ccl_lab_insert" ON public.cycle_count_lines
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'lab'
    AND EXISTS (
      SELECT 1 FROM public.cycle_counts cc
       WHERE cc.id = cycle_count_lines.cycle_count_id
         AND cc.lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
         AND cc.counted_by = auth.uid()
    )
  );

-- ─── 4. inventory_on_hand: allow count posting to adjust the summary ─────────
-- Staff can update any row; the lab role only their own lab's rows (and may
-- now also read their own lab's summary, which cycle counting implies).
DROP POLICY IF EXISTS "staff_update_inventory" ON public.inventory_on_hand;
CREATE POLICY "staff_update_inventory" ON public.inventory_on_hand
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('author','approver','operator')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('author','approver','operator')
    )
  );

DROP POLICY IF EXISTS "lab_read_own_inventory" ON public.inventory_on_hand;
CREATE POLICY "lab_read_own_inventory" ON public.inventory_on_hand
  FOR SELECT
  USING (
    public.current_user_role() = 'lab'
    AND lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "lab_update_own_inventory" ON public.inventory_on_hand;
CREATE POLICY "lab_update_own_inventory" ON public.inventory_on_hand
  FOR UPDATE
  USING (
    public.current_user_role() = 'lab'
    AND lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
  )
  WITH CHECK (
    public.current_user_role() = 'lab'
    AND lab_id = (SELECT default_lab_id FROM public.profiles WHERE id = auth.uid())
  );
