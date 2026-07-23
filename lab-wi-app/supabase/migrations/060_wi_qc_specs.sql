-- Migration 060: Work-Instruction-level QC specifications
-- ---------------------------------------------------------------------------
-- QC specs live on the reagent item (qc_tests). A Work Instruction can now carry
-- its OWN QC panel that DEFAULTS from the item's specs but may differ per WI —
-- captured as the last part of the run during execution.
--
--   wi_qc_tests   — the QC spec panel for a Work Instruction (mirrors qc_tests,
--                   keyed by work_instruction_id). source_qc_test_id remembers
--                   the item test it was defaulted from.
--   qc_results    — gains wi_qc_test_id so a captured result can point at the
--                   WI-level spec it was measured against. Item-sourced runs
--                   still use qc_test_id, exactly as before.
--
-- Run in the Supabase SQL Editor.

-- 1) WI-level QC spec panel --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wi_qc_tests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_instruction_id  uuid NOT NULL REFERENCES public.work_instructions(id) ON DELETE CASCADE,
  -- the item's qc_test this row was defaulted from (informational; not enforced onward)
  source_qc_test_id    uuid REFERENCES public.qc_tests(id) ON DELETE SET NULL,
  test_order           integer NOT NULL DEFAULT 0,
  name                 text NOT NULL,
  unit                 text,
  result_type          text NOT NULL DEFAULT 'numeric'
                         CHECK (result_type IN ('numeric','text','passfail')),
  lower_limit          numeric,
  upper_limit          numeric,
  target               numeric,
  expected_text        text,
  method               text,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES public.profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_wi_qc_tests_wi ON public.wi_qc_tests (work_instruction_id, test_order);

-- 2) Let a captured result reference a WI-level spec -------------------------
ALTER TABLE public.qc_results
  ADD COLUMN IF NOT EXISTS wi_qc_test_id uuid REFERENCES public.wi_qc_tests(id) ON DELETE SET NULL;

-- one result per WI-spec per order (mirrors the qc_test_id uniqueness)
CREATE UNIQUE INDEX IF NOT EXISTS uq_qc_results_order_wi_test
  ON public.qc_results (production_order_id, wi_qc_test_id)
  WHERE wi_qc_test_id IS NOT NULL;

-- 3) updated_at trigger (reuses the QC helper from migration 025) ------------
DROP TRIGGER IF EXISTS trg_wi_qc_tests_updated_at ON public.wi_qc_tests;
CREATE TRIGGER trg_wi_qc_tests_updated_at
  BEFORE UPDATE ON public.wi_qc_tests
  FOR EACH ROW EXECUTE FUNCTION public.set_qc_updated_at();

-- 4) RLS (mirrors qc_tests) --------------------------------------------------
ALTER TABLE public.wi_qc_tests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wi_qc_tests_read" ON public.wi_qc_tests;
CREATE POLICY "wi_qc_tests_read" ON public.wi_qc_tests
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "wi_qc_tests_write" ON public.wi_qc_tests;
CREATE POLICY "wi_qc_tests_write" ON public.wi_qc_tests
  FOR ALL
  USING (public.current_user_role() IN ('admin','author','approver'))
  WITH CHECK (public.current_user_role() IN ('admin','author','approver'));
