-- Migration 059: Work Instruction Templates
-- ---------------------------------------------------------------------------
-- A template is a Work Instruction with is_template = true. It is NOT linked to
-- a product but still runs the standard draft → pending_review → approved flow.
-- Once approved, a template can spawn child Work Instructions:
--
--   * the child copies the template's steps and their `locked` flags,
--   * the child records template_id + template_version (its lineage),
--   * each step carries source_step_id (the existing lineage token) so a locked
--     step on the template maps to the matching step on every child.
--
-- LOCKED steps are read-only on a child — the child author only fills in the
-- UNLOCKED steps (reagents, pH, …). Editing a locked step on the template and
-- pushing it "extrapolates" to derived WIs: draft/rejected children update in
-- place; approved children are flagged (template_needs_review) for an author to
-- re-version deliberately, rather than mutating an approved record.
--
-- Run in the Supabase SQL Editor.

-- 1) work_instructions: template flag + child lineage ------------------------
ALTER TABLE public.work_instructions
  ADD COLUMN IF NOT EXISTS is_template            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id            uuid REFERENCES public.work_instructions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_version       integer,
  ADD COLUMN IF NOT EXISTS template_needs_review  boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.work_instructions.is_template IS
  'True for a reusable template (no product link; still approved).';
COMMENT ON COLUMN public.work_instructions.template_id IS
  'For a child WI: the template it was generated from.';
COMMENT ON COLUMN public.work_instructions.template_version IS
  'For a child WI: the template version its locked steps are synced to.';
COMMENT ON COLUMN public.work_instructions.template_needs_review IS
  'Set on an approved child when the template changed a locked step after approval.';

CREATE INDEX IF NOT EXISTS idx_work_instructions_template_id ON public.work_instructions(template_id);
CREATE INDEX IF NOT EXISTS idx_work_instructions_is_template ON public.work_instructions(is_template);

-- Templates carry no product, so product_name must be optional. Keep it
-- required for real WIs via a CHECK.
ALTER TABLE public.work_instructions ALTER COLUMN product_name DROP NOT NULL;
ALTER TABLE public.work_instructions
  DROP CONSTRAINT IF EXISTS wi_product_required_unless_template;
ALTER TABLE public.work_instructions
  ADD CONSTRAINT wi_product_required_unless_template
    CHECK (is_template OR product_name IS NOT NULL);

-- 2) wi_steps: locked flag ---------------------------------------------------
ALTER TABLE public.wi_steps
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wi_steps.locked IS
  'On a template: this step is fixed on children. On a child: read-only (inherited from the template).';

-- 3) Audit log of locked-step propagations -----------------------------------
CREATE TABLE IF NOT EXISTS public.wi_template_syncs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id    uuid NOT NULL REFERENCES public.work_instructions(id) ON DELETE CASCADE,
  change_note    text NOT NULL,
  applied_count  integer NOT NULL DEFAULT 0,   -- draft/rejected children updated in place
  flagged_count  integer NOT NULL DEFAULT 0,   -- approved children flagged for review
  created_by     uuid REFERENCES public.profiles(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wi_template_syncs_template ON public.wi_template_syncs(template_id);

ALTER TABLE public.wi_template_syncs ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can read the sync history.
DROP POLICY IF EXISTS wi_template_syncs_select ON public.wi_template_syncs;
CREATE POLICY wi_template_syncs_select ON public.wi_template_syncs
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Authors / admins record a propagation (created_by must be the caller).
DROP POLICY IF EXISTS wi_template_syncs_insert ON public.wi_template_syncs;
CREATE POLICY wi_template_syncs_insert ON public.wi_template_syncs
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
    AND public.current_user_role() IN ('author', 'admin')
  );
