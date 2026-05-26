-- Migration 006: Reagent Items catalog (D365 integration)
-- Stores item master data synced from D365 Finance & Supply Chain.
-- Admins can manage items; authors have read-only access.

-- ─── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reagent_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- D365 identifiers
  item_number         text NOT NULL UNIQUE,           -- D365 ItemId  e.g. "NACL-0001"
  d365_product_id     text,                           -- D365 distinct product number (if different)
  d365_synced_at      timestamptz,                    -- last pulled from D365

  -- Core chemistry fields
  product_name        text NOT NULL,                  -- chemical/reagent name
  cas_number          text,                           -- CAS Registry Number e.g. "7647-14-5"
  molecular_formula   text,                           -- e.g. "NaCl"
  molecular_weight    numeric(12,4),                  -- g/mol
  purity_grade        text,                           -- e.g. "ACS Grade", "HPLC Grade"

  -- Logistics / supply chain (from D365)
  unit_of_measure     text NOT NULL DEFAULT 'g',      -- base UoM from D365
  min_order_qty       numeric(12,4),
  vendor              text,                           -- primary supplier name

  -- Lab-specific safety/storage
  storage_conditions  text,                           -- e.g. "Refrigerate 2–8 °C", "Room temperature"
  hazard_class        text,                           -- e.g. "Flammable", "Corrosive", "Oxidiser"
  ghs_pictograms      text[],                         -- e.g. ARRAY['GHS02','GHS07']
  sds_url             text,                           -- link to Safety Data Sheet

  -- Status
  is_active           boolean NOT NULL DEFAULT true,
  notes               text,

  -- Audit
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid REFERENCES profiles(id),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES profiles(id)
);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_reagent_items_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reagent_items_updated_at
  BEFORE UPDATE ON reagent_items
  FOR EACH ROW EXECUTE FUNCTION set_reagent_items_updated_at();

-- Indexes
CREATE INDEX idx_reagent_items_item_number ON reagent_items (item_number);
CREATE INDEX idx_reagent_items_product_name ON reagent_items (lower(product_name));
CREATE INDEX idx_reagent_items_cas ON reagent_items (cas_number) WHERE cas_number IS NOT NULL;
CREATE INDEX idx_reagent_items_active ON reagent_items (is_active);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE reagent_items ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY "admin_all_reagent_items" ON reagent_items
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Author + Approver: read active items only
CREATE POLICY "author_approver_read_reagent_items" ON reagent_items
  FOR SELECT
  USING (
    is_active = true
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('author', 'approver')
    )
  );
