-- Migration 013: Add print_labels step type

-- Extend check constraint on step_templates
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe',
      'print_labels','custom'
    ));

-- Insert system step template
INSERT INTO public.step_templates (name, description, step_type, parameter_schema, is_system)
VALUES (
  'Print Labels',
  'Print labels for containers, samples, or product lots.',
  'print_labels',
  '{"label_template": {"type": "string", "label": "Label Template"}, "quantity": {"type": "number", "label": "Quantity"}, "notes": {"type": "string", "label": "Notes"}}',
  true
)
ON CONFLICT DO NOTHING;
