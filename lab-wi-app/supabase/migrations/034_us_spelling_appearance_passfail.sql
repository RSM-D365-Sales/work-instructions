-- ============================================================
-- Migration 034: US English + Appearance as a Pass/Fail check
--   * Adds the 'passfail' QC result type (a Pass/Fail checkbox at capture)
--     to the qc_tests / qc_results CHECK constraints.
--   * Converts every existing "Appearance / Colour" release spec to a
--     Pass/Fail check named "Appearance / Color" — the operator just
--     ticks Pass instead of typing "Clear, colourless solution".
--   * Localises remaining "Colour"/"colourless" demo text to US spelling
--     (QC specs, captured-result snapshots, and Work Instruction prompts).
--   Idempotent: safe to re-run. Run in Supabase SQL Editor (after 033).
-- ============================================================

-- 1) Allow the new 'passfail' result type ----------------------------
ALTER TABLE public.qc_tests   DROP CONSTRAINT IF EXISTS qc_tests_result_type_check;
ALTER TABLE public.qc_tests   ADD  CONSTRAINT qc_tests_result_type_check
  CHECK (result_type IN ('numeric','text','passfail'));

ALTER TABLE public.qc_results DROP CONSTRAINT IF EXISTS qc_results_result_type_check;
ALTER TABLE public.qc_results ADD  CONSTRAINT qc_results_result_type_check
  CHECK (result_type IN ('numeric','text','passfail'));

-- 2) US spelling + Pass/Fail for the Appearance specs ----------------
UPDATE public.qc_tests
   SET name          = replace(name, 'Colour', 'Color'),
       expected_text = replace(expected_text, 'colourless', 'colorless'),
       result_type   = 'passfail'
 WHERE name ILIKE 'Appearance%';

-- Fix spelling on any already-captured result snapshots (keep their
-- original result_type so issued certificates stay immutable).
UPDATE public.qc_results
   SET name          = replace(name, 'Colour', 'Color'),
       expected_text = replace(expected_text, 'colourless', 'colorless')
 WHERE name ILIKE 'Appearance%';

-- 3) US spelling in the Work Instruction observe-step prompts --------
UPDATE public.wi_steps
   SET parameters = jsonb_set(
                      parameters,
                      '{prompt}',
                      to_jsonb(replace(parameters->>'prompt', 'colourless', 'colorless'))
                    )
 WHERE parameters->>'prompt' ILIKE '%colourless%';
