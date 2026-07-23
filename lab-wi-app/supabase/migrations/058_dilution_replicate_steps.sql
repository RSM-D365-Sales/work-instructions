-- Migration 058: Two new step types — dilution & replicate_measurement
-- ---------------------------------------------------------------------------
--   dilution              A C1·V1 = C2·V2 dilution calculator. The author picks
--                         which of the four variables to solve for; the operator
--                         enters the three knowns and the unknown is computed
--                         live. When solving for a volume, the diluent volume to
--                         add (V2 − V1) is computed too.
--
--   replicate_measurement Take N replicate readings of a value and record their
--                         average. The value can be simple (a number in one unit)
--                         or a ratio (numerator / denominator, e.g. cells / mL).
--
-- As elsewhere, wi_steps has NO step_type column — the type lives in
-- wi_steps.parameters->>'_step_type'. Only step_templates carries the CHECK.

-- 1) Extend the step_templates step_type CHECK constraint --------------------
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      -- existing (through migration 052)
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe',
      'notes','production_break','print_labels','possible_deviation',
      'attachment','user_defined','custom',
      'dispense','agitate','freeze','thaw','overnight',
      'bring_to_volume','cap','package','record_time',
      -- new in 058
      'dilution','replicate_measurement'
    ));

-- 2) Seed one system step template per new type -----------------------------
--    parameter_schema is descriptive (drives the library card); the editor and
--    execution pages render a dedicated form per type.
INSERT INTO public.step_templates (name, description, step_type, parameter_schema, is_system)
VALUES
  (
    'Dilution Calculation',
    'Solve C1·V1 = C2·V2 for the unknown variable. Enter any three of stock concentration (C1), stock volume (V1), final concentration (C2) and final volume (V2); the fourth — and the diluent volume to add — is calculated.',
    'dilution',
    '{"solve_for": {"type": "string", "label": "Solve For", "options": ["C1", "V1", "C2", "V2"], "default": "V1"}, "conc_unit": {"type": "string", "label": "Concentration Unit", "default": "%"}, "vol_unit": {"type": "string", "label": "Volume Unit", "default": "L"}, "diluent_name": {"type": "string", "label": "Diluent"}}',
    true
  ),
  (
    'Replicate Measurement',
    'Take a set number of replicate readings of a value and record their average. The value can be a simple number (one unit) or a ratio such as cells / mL.',
    'replicate_measurement',
    '{"measurement_name": {"type": "string", "label": "Measurement"}, "replicate_count": {"type": "number", "label": "Number of Replicates", "default": 3}, "mode": {"type": "string", "label": "Value Type", "options": ["simple", "ratio"], "default": "simple"}, "unit": {"type": "string", "label": "Unit (simple mode)"}, "num_unit": {"type": "string", "label": "Numerator Unit (ratio mode)", "default": "cells"}, "den_unit": {"type": "string", "label": "Denominator Unit (ratio mode)", "default": "mL"}}',
    true
  )
ON CONFLICT DO NOTHING;
