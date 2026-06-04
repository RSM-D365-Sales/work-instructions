-- Migration 038: Add possible_deviation step type
-- A step the operator uses to flag a possible deviation during a run. It captures
-- an "impacted quantity" and exposes a red "Notify Supervisor" action that
-- broadcasts a Microsoft Teams message ("Production Order #### — Technician
-- requests assistance").

-- Extend check constraint on step_templates
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe',
      'notes','production_break','print_labels','possible_deviation','custom'
    ));

-- Insert system step template
INSERT INTO public.step_templates (name, description, step_type, parameter_schema, is_system)
VALUES (
  'Possible Deviation',
  'Flag a possible deviation, record the impacted quantity, and notify the supervisor via Teams.',
  'possible_deviation',
  '{"prompt": {"type": "string", "label": "Deviation Prompt"}, "unit": {"type": "string", "label": "Impacted Quantity Unit", "default": "L"}}',
  true
)
ON CONFLICT DO NOTHING;
