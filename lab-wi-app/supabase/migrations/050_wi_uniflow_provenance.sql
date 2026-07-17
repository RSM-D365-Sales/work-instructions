-- Migration 050: Uniflow provenance on work_instructions
--
-- The bulk migration reads ARUP's Uniflow "PROD data dump" (one row per
-- material at its current version: materialId, materialVersionId, description,
-- formPlan). Every migrated WI starts fresh at Rocket Ship version = 1, but we
-- keep the Uniflow lineage so a recipe can be traced back to its source:
--   * uniflow_material_id   — Uniflow materialId   (e.g. 'A-00005')
--   * uniflow_version_id    — Uniflow materialVersionId (e.g. 'A-00005-37')
--   * uniflow_version       — the trailing integer of the versionId (37);
--                             NULL when it doesn't parse (~8% of rows).
-- All nullable/additive — native Rocket Ship WIs simply leave them NULL.
-- Run in the Supabase SQL Editor.

ALTER TABLE public.work_instructions
  ADD COLUMN IF NOT EXISTS uniflow_material_id text,
  ADD COLUMN IF NOT EXISTS uniflow_version_id  text,
  ADD COLUMN IF NOT EXISTS uniflow_version     integer;

CREATE INDEX IF NOT EXISTS idx_wi_uniflow_material
  ON public.work_instructions (uniflow_material_id);
