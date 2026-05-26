-- Migration 012: Add gather_equipment and gather_reagents step types
-- Extends the check constraint on step_templates to allow the two new types.
-- (wi_steps does NOT have a step_type column; type is stored in parameters._step_type JSON)

-- step_templates table
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe','custom'
    ));

-- Insert system step templates for the two new types
INSERT INTO public.step_templates (name, description, step_type, parameter_schema, is_system)
VALUES
  (
    'Gather Equipment',
    'List all lab equipment needed for this procedure.',
    'gather_equipment',
    '{"equipment": {"type": "array", "label": "Equipment List", "items": {"name": {"type": "string", "label": "Item Name"}, "notes": {"type": "string", "label": "Notes"}}}}',
    true
  ),
  (
    'Gather Reagents',
    'Collect and verify all reagents from the item catalog before proceeding.',
    'gather_reagents',
    '{"reagents": {"type": "array", "label": "Reagents", "items": {"item_id": {"type": "string", "label": "Item ID"}, "item_number": {"type": "string", "label": "Item #"}, "product_name": {"type": "string", "label": "Product Name"}, "quantity": {"type": "number", "label": "Quantity"}, "unit": {"type": "string", "label": "Unit"}}}}',
    true
  )
ON CONFLICT DO NOTHING;
