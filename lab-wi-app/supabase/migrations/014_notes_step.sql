-- Migration 014: Add notes step type
-- Gives the scientist a spot to capture free-text notes about the order up to this step.

-- Extend check constraint on step_templates
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe',
      'notes','print_labels','custom'
    ));

-- Insert system step template
INSERT INTO public.step_templates (name, description, step_type, parameter_schema, is_system)
VALUES (
  'Notes',
  'Capture free-text notes about the order up to this step.',
  'notes',
  '{"prompt": {"type": "string", "label": "Notes Prompt"}}',
  true
)
ON CONFLICT DO NOTHING;
