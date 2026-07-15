-- ============================================================
-- Migration 042: Planned production orders (D365 Master Planning)
--
-- Models D365 F&SC planned production / planned batch orders. For
-- the demo the table is filled by a seed script (see
-- scripts/seed_planned_production_orders.sql); in a live build the
-- rows would be ingested from D365 Planning Optimization output.
--
-- Field mapping to the D365 "Planned order" form:
--   number             → Number            (e.g. G60G0126000497)
--   reference          → Reference         ('Planned production orders')
--   reagent_item_id    → Item number / Product name (via reagent_items)
--   quantity / unit    → Requirement quantity / CW unit
--   requirement_date   → REQUIREMENT · Requirement date  (never edited —
--                        moving supply does not move the demand)
--   order_date         → ORDER · Order date (planned start; editable.
--                        The UI warns when it is moved past the
--                        requirement date: that delays the requirement)
--   delivery_date      → Delivery date     (editable, same warning)
--   planning_priority  → Planning priority
--   site / warehouse   → STORAGE DIMENSIONS · Site / Warehouse
--   plan_name          → PLAN · Name       ('Master')
--   bom_number         → BOM number
--   route_number       → Route number
--   pegging            → Pegging grid      (jsonb array of
--                        {reference, number, requirement_date, quantity})
--   status             → 'unprocessed' until firmed; firming creates a
--                        production order against the item's default
--                        formula (its approved work instruction) and
--                        stamps firmed_* + the created order's id.
--
-- Run in the Supabase SQL Editor.
-- ============================================================

-- 1) D365-style number sequence -------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.planned_orders_seq START 1;

-- 2) Table ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.planned_production_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number              text NOT NULL UNIQUE
                        DEFAULT ('G60G0126' || lpad(nextval('public.planned_orders_seq')::text, 6, '0')),
  reference           text NOT NULL DEFAULT 'Planned production orders',

  reagent_item_id     uuid NOT NULL REFERENCES public.reagent_items(id) ON DELETE CASCADE,
  quantity            numeric NOT NULL CHECK (quantity > 0),
  unit                text NOT NULL DEFAULT 'L',

  requirement_date    date NOT NULL,           -- fixed demand date (read-only in UI)
  order_date          date NOT NULL,           -- planned start (editable)
  delivery_date       date,                    -- planned delivery (editable)

  planning_priority   numeric NOT NULL DEFAULT 0,
  site                text NOT NULL DEFAULT '1',
  warehouse           text NOT NULL DEFAULT 'REAGENT',
  plan_name           text NOT NULL DEFAULT 'Master',
  bom_number          text,
  route_number        text,

  pegging             jsonb NOT NULL DEFAULT '[]'::jsonb,

  status              text NOT NULL DEFAULT 'unprocessed'
                        CHECK (status IN ('unprocessed', 'firmed')),

  -- Future D365 sync: the planned order id in D365 (ReqPO number).
  d365_ref_id         text,

  -- Set when the planned order is firmed into a production order.
  firmed_production_order_id uuid REFERENCES public.production_orders(id) ON DELETE SET NULL,
  firmed_by           uuid REFERENCES public.profiles(id),
  firmed_at           timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planned_orders_status      ON public.planned_production_orders (status);
CREATE INDEX IF NOT EXISTS idx_planned_orders_req_date    ON public.planned_production_orders (requirement_date);
CREATE INDEX IF NOT EXISTS idx_planned_orders_item        ON public.planned_production_orders (reagent_item_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_planned_orders_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_planned_orders_updated_at ON public.planned_production_orders;
CREATE TRIGGER trg_planned_orders_updated_at
  BEFORE UPDATE ON public.planned_production_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_planned_orders_updated_at();

-- 3) RLS --------------------------------------------------------------
ALTER TABLE public.planned_production_orders ENABLE ROW LEVEL SECURITY;

-- Admin: full access
DROP POLICY IF EXISTS "planned_orders_admin_all" ON public.planned_production_orders;
CREATE POLICY "planned_orders_admin_all" ON public.planned_production_orders
  FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- Internal roles: read
DROP POLICY IF EXISTS "planned_orders_internal_read" ON public.planned_production_orders;
CREATE POLICY "planned_orders_internal_read" ON public.planned_production_orders
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND public.current_user_role() IN ('author', 'approver', 'operator')
  );

-- Approvers (planners): can edit dates / firm
DROP POLICY IF EXISTS "planned_orders_approver_update" ON public.planned_production_orders;
CREATE POLICY "planned_orders_approver_update" ON public.planned_production_orders
  FOR UPDATE
  USING (public.current_user_role() = 'approver')
  WITH CHECK (public.current_user_role() = 'approver');
