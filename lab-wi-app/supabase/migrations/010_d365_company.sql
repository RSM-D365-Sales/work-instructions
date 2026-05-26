-- Migration 010: Add company field to d365_config
-- D365 Finance & Supply Chain supports per-legal-entity data access via
-- the ?company=<code> OData query parameter (e.g. USP2, USMF).
-- Blank means the environment default / all companies (cross-company=true).

ALTER TABLE public.d365_config
  ADD COLUMN IF NOT EXISTS company text NOT NULL DEFAULT '';
