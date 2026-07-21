-- Migration 056: Standing (recurring) Reagent Orders
-- ---------------------------------------------------------------------------
-- A standing order captures a repeating reagent request — "20 L of X every
-- Monday until 21 Dec" — as a pattern plus a set of template lines.
--
-- Generation model: every reagent order in the series is created UP FRONT when
-- the standing order is saved. The standing order is therefore always bounded
-- (an end date or a fixed number of deliveries — never open-ended), and the
-- generated orders are ordinary rows in reagent_orders / reagent_order_items
-- so the existing list, detail, delivery and dashboard screens work unchanged.
-- The link back to the series is reagent_orders.standing_order_id.
--
-- Cancelling a series is done through public.cancel_standing_order(), which
-- also cancels the not-yet-due orders it created. It is SECURITY DEFINER
-- because the 'lab' role can create a series but has no UPDATE right on
-- reagent_orders. Run in the Supabase SQL Editor.

-- ─── 1) Series header ────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.standing_orders_seq START 1;

CREATE TABLE IF NOT EXISTS public.standing_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  standing_order_number text NOT NULL UNIQUE
                          DEFAULT ('SO-' || to_char(now(), 'YYYY') || '-' ||
                                   lpad(nextval('public.standing_orders_seq')::text, 4, '0')),

  lab_id                uuid NOT NULL REFERENCES public.labs(id) ON DELETE RESTRICT,
  created_by            uuid NOT NULL REFERENCES public.profiles(id),  -- the entry creator
  requested_by          uuid NOT NULL REFERENCES public.profiles(id),  -- on-behalf-of

  -- Recurrence pattern -------------------------------------------------------
  frequency             text NOT NULL CHECK (frequency IN ('weekly','monthly')),
  -- "every N weeks" / "every N months"
  interval_count        integer NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 12),
  -- weekly only: 0=Sunday … 6=Saturday, one order per selected weekday
  weekdays              smallint[],
  -- monthly only: 1..31, clamped to the last day of shorter months
  day_of_month          smallint,

  start_date            date NOT NULL,

  -- End rule: an explicit date, or a fixed number of deliveries.
  end_mode              text NOT NULL CHECK (end_mode IN ('date','count')),
  end_date              date,
  occurrence_count      integer CHECK (occurrence_count > 0),

  notes                 text,
  high_priority         boolean NOT NULL DEFAULT false,

  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','completed','cancelled')),

  -- Snapshot of what generation produced (the orders themselves are the truth).
  generated_count       integer NOT NULL DEFAULT 0,
  first_order_date      date,
  last_order_date       date,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- Pattern fields must match the chosen frequency.
  CONSTRAINT standing_orders_pattern_ck CHECK (
    (frequency = 'weekly'
       AND weekdays IS NOT NULL AND array_length(weekdays, 1) BETWEEN 1 AND 7
       AND day_of_month IS NULL)
    OR
    (frequency = 'monthly'
       AND day_of_month BETWEEN 1 AND 31
       AND weekdays IS NULL)
  ),

  -- Exactly one end rule must be supplied; a series can never be open-ended
  -- because all of its orders are materialised at save time.
  CONSTRAINT standing_orders_end_ck CHECK (
    (end_mode = 'date'  AND end_date IS NOT NULL AND occurrence_count IS NULL)
    OR
    (end_mode = 'count' AND occurrence_count IS NOT NULL AND end_date IS NULL)
  ),

  CONSTRAINT standing_orders_end_after_start_ck CHECK (
    end_date IS NULL OR end_date >= start_date
  )
);

CREATE INDEX IF NOT EXISTS idx_standing_orders_lab     ON public.standing_orders (lab_id);
CREATE INDEX IF NOT EXISTS idx_standing_orders_status  ON public.standing_orders (status);
CREATE INDEX IF NOT EXISTS idx_standing_orders_created ON public.standing_orders (created_at DESC);

-- ─── 2) Template lines ───────────────────────────────────────────────────────
-- Copied onto every generated order's reagent_order_items.
CREATE TABLE IF NOT EXISTS public.standing_order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  standing_order_id uuid NOT NULL REFERENCES public.standing_orders(id) ON DELETE CASCADE,
  line_number       integer NOT NULL,
  reagent_item_id   uuid NOT NULL REFERENCES public.reagent_items(id) ON DELETE RESTRICT,
  quantity          numeric NOT NULL CHECK (quantity > 0),
  unit              text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (standing_order_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_standing_order_items_parent
  ON public.standing_order_items (standing_order_id);

-- ─── 3) Link generated orders back to their series ───────────────────────────
ALTER TABLE public.reagent_orders
  ADD COLUMN IF NOT EXISTS standing_order_id  uuid REFERENCES public.standing_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS standing_order_seq integer;   -- 1-based position in the series

CREATE INDEX IF NOT EXISTS idx_reagent_orders_standing
  ON public.reagent_orders (standing_order_id) WHERE standing_order_id IS NOT NULL;

-- ─── 4) updated_at trigger ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_standing_orders_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_standing_orders_updated_at ON public.standing_orders;
CREATE TRIGGER trg_standing_orders_updated_at
  BEFORE UPDATE ON public.standing_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_standing_orders_updated_at();

-- ─── 5) RLS — mirrors reagent_orders (migration 018) ─────────────────────────
ALTER TABLE public.standing_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "standing_orders_admin_all" ON public.standing_orders;
CREATE POLICY "standing_orders_admin_all" ON public.standing_orders
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "standing_orders_internal_read" ON public.standing_orders;
CREATE POLICY "standing_orders_internal_read" ON public.standing_orders
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND public.current_user_role() IN ('author','approver','operator')
  );

DROP POLICY IF EXISTS "standing_orders_internal_insert" ON public.standing_orders;
CREATE POLICY "standing_orders_internal_insert" ON public.standing_orders
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.current_user_role() IN ('author','approver','operator')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "standing_orders_internal_update" ON public.standing_orders;
CREATE POLICY "standing_orders_internal_update" ON public.standing_orders
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND public.current_user_role() IN ('author','approver','operator')
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.current_user_role() IN ('author','approver','operator')
  );

-- Lab role: sees only its own lab's series, and can create new ones.
DROP POLICY IF EXISTS "standing_orders_lab_read" ON public.standing_orders;
CREATE POLICY "standing_orders_lab_read" ON public.standing_orders
  FOR SELECT
  USING (
    public.current_user_role() = 'lab'
    AND lab_id IN (
      SELECT default_lab_id FROM public.profiles
       WHERE id = auth.uid() AND default_lab_id IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "standing_orders_lab_insert" ON public.standing_orders;
CREATE POLICY "standing_orders_lab_insert" ON public.standing_orders
  FOR INSERT
  WITH CHECK (
    public.current_user_role() = 'lab'
    AND created_by = auth.uid()
  );

-- Template lines: read/insert mirror the parent series (same shape as
-- reagent_order_items in migration 020).
ALTER TABLE public.standing_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "soi_admin_all" ON public.standing_order_items;
CREATE POLICY "soi_admin_all" ON public.standing_order_items
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

DROP POLICY IF EXISTS "soi_select" ON public.standing_order_items;
CREATE POLICY "soi_select" ON public.standing_order_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.standing_orders s
       WHERE s.id = standing_order_items.standing_order_id
         AND (
           public.current_user_role() IN ('author','approver','operator')
           OR (
             public.current_user_role() = 'lab'
             AND s.lab_id IN (
               SELECT default_lab_id FROM public.profiles
                WHERE id = auth.uid() AND default_lab_id IS NOT NULL
             )
           )
         )
    )
  );

DROP POLICY IF EXISTS "soi_insert" ON public.standing_order_items;
CREATE POLICY "soi_insert" ON public.standing_order_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.standing_orders s
       WHERE s.id = standing_order_items.standing_order_id
         AND s.created_by = auth.uid()
         AND public.current_user_role() IN ('author','approver','operator','lab')
    )
  );

DROP POLICY IF EXISTS "soi_update" ON public.standing_order_items;
CREATE POLICY "soi_update" ON public.standing_order_items
  FOR UPDATE
  USING (public.current_user_role() IN ('author','approver','operator'))
  WITH CHECK (public.current_user_role() IN ('author','approver','operator'));

DROP POLICY IF EXISTS "soi_delete" ON public.standing_order_items;
CREATE POLICY "soi_delete" ON public.standing_order_items
  FOR DELETE
  USING (public.current_user_role() IN ('author','approver','operator'));

-- ─── 6) Cancel a series and its future orders ────────────────────────────────
-- SECURITY DEFINER: the 'lab' role may cancel a series it owns, but has no
-- UPDATE grant on reagent_orders. Only orders that are still pending AND not
-- yet due are cancelled — anything already in progress, delivered or past due
-- is left alone so history stays intact.
CREATE OR REPLACE FUNCTION public.cancel_standing_order(p_standing_order_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role       text := public.current_user_role();
  v_lab_id     uuid;
  v_cancelled  integer;
BEGIN
  SELECT lab_id INTO v_lab_id
    FROM public.standing_orders
   WHERE id = p_standing_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Standing order not found';
  END IF;

  IF v_role NOT IN ('admin','author','approver')
     AND NOT (
       v_role = 'lab'
       AND v_lab_id IN (
         SELECT default_lab_id FROM public.profiles
          WHERE id = auth.uid() AND default_lab_id IS NOT NULL
       )
     )
  THEN
    RAISE EXCEPTION 'Not permitted to cancel this standing order';
  END IF;

  UPDATE public.standing_orders
     SET status = 'cancelled'
   WHERE id = p_standing_order_id;

  UPDATE public.reagent_orders
     SET status = 'cancelled'
   WHERE standing_order_id = p_standing_order_id
     AND status = 'pending'
     AND requested_for_date > CURRENT_DATE;

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;
  RETURN v_cancelled;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_standing_order(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.cancel_standing_order(uuid) TO authenticated;
