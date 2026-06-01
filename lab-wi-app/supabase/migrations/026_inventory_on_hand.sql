-- Migration 026: On-hand inventory (modelled on D365 Finance & Supply Chain)
-- Adds an item product-type classification (FG / RM / PKG) to reagent_items and
-- an inventory_on_hand table holding the D365-style on-hand quantities per item
-- per reagent lab (warehouse). For this presales demo the table is seeded with
-- realistic quantities so it looks as though it was synced from D365 F&SC — there
-- is no live sync.
--
-- On-hand columns mirror the D365 "On-hand inventory" form:
--   physical_inventory  → Physical inventory   (posted on-hand qty)
--   physical_reserved   → Physical reserved    (reserved against physical stock)
--   ordered_in          → Ordered in (total)   (inbound receipts not yet posted)
--   on_order            → On order             (qty on open purchase/transfer orders)
--   available_physical  → Physical inventory − Physical reserved      (computed in app)
--   total_available     → Available physical + Ordered in + On order  (computed in app)

-- ─── 1. item_type on reagent_items ───────────────────────────────────────────
ALTER TABLE public.reagent_items
  ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'RM'
    CHECK (item_type IN ('FG', 'RM', 'PKG'));

COMMENT ON COLUMN public.reagent_items.item_type IS
  'D365 product classification: FG = finished good, RM = raw material, PKG = packaging';

-- Auto-classify existing items by a simple name heuristic (admins can override
-- afterwards via the Reagent Items edit modal).
UPDATE public.reagent_items SET item_type =
  CASE
    WHEN lower(product_name) ~ '(bottle|vial|cap|label|box|carton|container|packag|pipette|tip|stopper|seal)' THEN 'PKG'
    WHEN lower(product_name) ~ '(buffer|solution|reagent|diluent|standard|control|media|stain|prepared|working|assay|mix)' THEN 'FG'
    ELSE 'RM'
  END
WHERE item_type = 'RM';  -- only re-touch the default; preserves anything set manually

CREATE INDEX IF NOT EXISTS idx_reagent_items_item_type ON public.reagent_items (item_type);

-- ─── 2. inventory_on_hand table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_on_hand (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  reagent_item_id     uuid NOT NULL REFERENCES public.reagent_items(id) ON DELETE CASCADE,
  lab_id              uuid NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,

  -- D365-style on-hand quantities (base unit of measure of the item)
  physical_inventory  numeric(14,2) NOT NULL DEFAULT 0,
  physical_reserved   numeric(14,2) NOT NULL DEFAULT 0,
  ordered_in          numeric(14,2) NOT NULL DEFAULT 0,
  on_order            numeric(14,2) NOT NULL DEFAULT 0,

  -- Looks like it came from D365
  d365_synced_at      timestamptz NOT NULL DEFAULT now(),

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (reagent_item_id, lab_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_item ON public.inventory_on_hand (reagent_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lab  ON public.inventory_on_hand (lab_id);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.set_inventory_on_hand_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_on_hand_updated_at ON public.inventory_on_hand;
CREATE TRIGGER trg_inventory_on_hand_updated_at
  BEFORE UPDATE ON public.inventory_on_hand
  FOR EACH ROW EXECUTE FUNCTION public.set_inventory_on_hand_updated_at();

-- ─── 3. RLS — readable by everyone EXCEPT the Lab Scientist (lab) role ────────
ALTER TABLE public.inventory_on_hand ENABLE ROW LEVEL SECURITY;

-- Admin: full access
DROP POLICY IF EXISTS "admin_all_inventory" ON public.inventory_on_hand;
CREATE POLICY "admin_all_inventory" ON public.inventory_on_hand
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Author / Approver / Operator: read-only. The 'lab' (Lab Scientist) role is
-- intentionally excluded.
DROP POLICY IF EXISTS "staff_read_inventory" ON public.inventory_on_hand;
CREATE POLICY "staff_read_inventory" ON public.inventory_on_hand
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('author', 'approver', 'operator')
    )
  );

-- ─── 4. Seed demo on-hand data (looks D365-synced) ───────────────────────────
-- For each active item we stock a random subset of active labs with believable
-- quantities. Reserved is always a fraction of physical; ordered_in / on_order
-- appear on a minority of lines (as in a real warehouse).
WITH combos AS (
  SELECT
    ri.id  AS reagent_item_id,
    l.id   AS lab_id,
    round(random() * 900 + 40) AS phys                                                   -- whole-number qty
  FROM public.reagent_items ri
  CROSS JOIN public.labs l
  WHERE ri.is_active
    AND l.is_active
    AND random() < 0.6          -- ~60% of item × lab combinations carry stock
)
INSERT INTO public.inventory_on_hand
  (reagent_item_id, lab_id, physical_inventory, physical_reserved, ordered_in, on_order, d365_synced_at)
SELECT
  reagent_item_id,
  lab_id,
  phys,
  round(phys * random() * 0.4),                                            -- reserved ≤ 40% of physical
  CASE WHEN random() < 0.40 THEN round(random() * 300) ELSE 0 END,         -- ordered in
  CASE WHEN random() < 0.30 THEN round(random() * 500) ELSE 0 END,         -- on order
  now() - (random() * interval '6 hours')                                  -- "last sync" within today
FROM combos
ON CONFLICT (reagent_item_id, lab_id) DO NOTHING;

-- Round any rows seeded by an earlier run of this migration so re-running cleans
-- up the original two-decimal demo data.
UPDATE public.inventory_on_hand SET
  physical_inventory = round(physical_inventory),
  physical_reserved  = round(physical_reserved),
  ordered_in         = round(ordered_in),
  on_order           = round(on_order)
WHERE physical_inventory <> round(physical_inventory)
   OR physical_reserved  <> round(physical_reserved)
   OR ordered_in         <> round(ordered_in)
   OR on_order           <> round(on_order);
