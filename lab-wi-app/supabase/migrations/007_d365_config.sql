-- Migration 007: D365 connection configuration
-- Stores D365 Finance & Supply Chain connection settings for the sync edge function.
-- The client_secret is NEVER stored here — it must be set as a Supabase secret:
--   supabase secrets set D365_CLIENT_SECRET=<your_secret>

CREATE TABLE IF NOT EXISTS d365_config (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  d365_url        text NOT NULL DEFAULT '',  -- e.g. https://myorg.sandbox.operations.dynamics.com
  tenant_id       text NOT NULL DEFAULT '',  -- Azure/Entra tenant GUID
  client_id       text NOT NULL DEFAULT '',  -- Entra app registration client GUID
  buyer_group     text DEFAULT '',           -- D365 BuyerGroupId filter (blank = all)
  enabled         boolean NOT NULL DEFAULT false,

  -- Last sync metadata (written by the edge function)
  last_sync_at     timestamptz,
  last_sync_status text,  -- 'success' | 'error' | 'partial'
  last_sync_count  int,
  last_sync_error  text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_d365_config_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_d365_config_updated_at
  BEFORE UPDATE ON d365_config
  FOR EACH ROW EXECUTE FUNCTION set_d365_config_updated_at();

-- Seed a single config row so admins can UPDATE rather than INSERT
INSERT INTO d365_config (id, d365_url, tenant_id, client_id, buyer_group, enabled)
VALUES ('00000000-0000-0000-0000-000000000001', '', '', '', '', false)
ON CONFLICT (id) DO NOTHING;

-- ─── RLS — admin only ─────────────────────────────────────────────────────────
ALTER TABLE d365_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all_d365_config" ON d365_config
  FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
