-- Migration 041: Add user_defined step type
-- Lets authors create their own step templates with configurable parameters
-- (defined in parameter_schema), rendered generically in the WI editor and
-- during production order execution — like system templates, without code.

-- Extend check constraint on step_templates
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe',
      'notes','production_break','print_labels','possible_deviation',
      'user_defined','custom'
    ));
