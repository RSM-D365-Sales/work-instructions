-- Migration 015: Add production_break step type
-- A divider step marking the boundary between two distinct portions of a
-- production run (e.g. Part 1: make the buffer, Part 2: fill tubes with buffer).

-- Extend check constraint on step_templates
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe',
      'notes','production_break','print_labels','custom'
    ));

-- Insert system step template
INSERT INTO public.step_templates (name, description, step_type, parameter_schema, is_system)
VALUES (
  'Production Break',
  'Mark the boundary between two distinct portions of a production run.',
  'production_break',
  '{"label": {"type": "string", "label": "Next Part Label"}, "description": {"type": "string", "label": "Description"}}',
  true
)
ON CONFLICT DO NOTHING;
