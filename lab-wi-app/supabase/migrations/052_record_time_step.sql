-- Migration 052: Add record_time step type
-- ---------------------------------------------------------------------------
-- Uniflow's `currentTime` formPart (with a `getTimeButton`) is an operator-
-- recorded timestamp — e.g. the "Start time:" / "End Time:" pair that brackets
-- the water-bath warming period in A8 Agar. It was tripping the migration
-- agent's scope gate; this adds a first-class step so it converts instead.
--
-- At run time the operator taps "Record current time" and the ISO timestamp is
-- captured on the po_step's actual_values ({recorded_at}). As elsewhere,
-- wi_steps has no step_type column — the type lives in parameters->>'_step_type'.

-- 1) Extend the step_templates step_type CHECK constraint --------------------
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      -- existing (through migration 051)
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe',
      'notes','production_break','print_labels','possible_deviation',
      'attachment','user_defined','custom',
      'dispense','agitate','freeze','thaw','overnight',
      'bring_to_volume','cap','package',
      -- new in 052
      'record_time'
    ));

-- 2) Seed the system step template ------------------------------------------
INSERT INTO public.step_templates (name, description, step_type, parameter_schema, is_system)
VALUES (
  'Record Time',
  'Capture an operator-recorded timestamp (e.g. a start / end time) during the run.',
  'record_time',
  '{"label": {"type": "string", "label": "Timestamp Label", "default": "Time"}, "prompt": {"type": "string", "label": "Instructions"}}',
  true
)
ON CONFLICT DO NOTHING;
