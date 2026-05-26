-- Migration 016: Labs (D365 Warehouses) + per-user default lab
-- Pulls D365 Finance & Supply Chain InventoryWarehouses into a local `labs`
-- table that admins can manage. Every user can pick a "default lab" for
-- themselves, stored on the profile.

-- ─── labs table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.labs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- D365 identity
  warehouse_id    text NOT NULL UNIQUE,        -- D365 InventLocationId  e.g. "LAB-01"
  name            text NOT NULL,               -- WMSLocationName / display name
  description     text,
  site_id         text,                        -- D365 InventSiteId
  d365_company    text,                        -- legal entity dataAreaId
  d365_synced_at  timestamptz,

  is_active       boolean NOT NULL DEFAULT true,
  notes           text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_labs_warehouse_id ON public.labs (warehouse_id);
CREATE INDEX IF NOT EXISTS idx_labs_active ON public.labs (is_active);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.set_labs_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_labs_updated_at ON public.labs;
CREATE TRIGGER trg_labs_updated_at
  BEFORE UPDATE ON public.labs
  FOR EACH ROW EXECUTE FUNCTION public.set_labs_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;

-- Admin: full access
DROP POLICY IF EXISTS "admin_all_labs" ON public.labs;
CREATE POLICY "admin_all_labs" ON public.labs
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Any authenticated user can read active labs (needed so anyone can pick a default)
DROP POLICY IF EXISTS "auth_read_active_labs" ON public.labs;
CREATE POLICY "auth_read_active_labs" ON public.labs
  FOR SELECT
  USING (
    is_active = true
    AND auth.uid() IS NOT NULL
  );

-- ─── default_lab_id on profiles ──────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_lab_id uuid REFERENCES public.labs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_default_lab_idx ON public.profiles (default_lab_id);
