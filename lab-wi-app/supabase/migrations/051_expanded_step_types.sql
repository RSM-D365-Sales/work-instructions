-- Migration 051: Expanded step-type vocabulary for the Uniflow mapping exercise
-- ---------------------------------------------------------------------------
-- The Uniflow migration was flattening many distinct lab actions into a handful
-- of generic steps (chiefly `custom`). This migration adds eight first-class
-- step types so the conversion agent can map one Uniflow action → one typed
-- step instead of many → one:
--
--   dispense        volumetric measure — the liquid analogue of `weigh`
--   agitate         stir / vortex / invert (distinct from the timed `mix`)
--   freeze          freeze / store frozen  (cool stays for chilling)
--   thaw            thaw / bring up from frozen
--   overnight       an overnight hold / incubation
--   bring_to_volume Q.S. / dilute / bring to final volume
--   cap             cap / seal / parafilm
--   package         package / box / store / deliver to destination
--
-- `transfer`, `mix`, and `cool` already exist and keep their meaning; the agent
-- verb-mapping (see UNIFLOW_TO_ROCKETSHIP_AGENT.md) folds the full transfer
-- family (transfer/pour/aliquot/decant/elute/filter) into `transfer`.
--
-- As elsewhere, wi_steps has NO step_type column — the type lives in
-- wi_steps.parameters->>'_step_type'. Only step_templates carries the CHECK.

-- 1) Extend the step_templates step_type CHECK constraint --------------------
ALTER TABLE public.step_templates
  DROP CONSTRAINT IF EXISTS step_templates_step_type_check;

ALTER TABLE public.step_templates
  ADD CONSTRAINT step_templates_step_type_check
    CHECK (step_type IN (
      -- existing
      'gather_inputs','gather_equipment','gather_reagents',
      'weigh','mix','transfer','ph_adjust','heat','cool','observe',
      'notes','production_break','print_labels','possible_deviation',
      'attachment','user_defined','custom',
      -- new in 051
      'dispense','agitate','freeze','thaw','overnight',
      'bring_to_volume','cap','package'
    ));

-- 2) Seed one system step template per new type -----------------------------
--    parameter_schema mirrors the sibling built-in steps; the editor renders a
--    dedicated form per type, so the schema is descriptive (drives the library
--    card + any generic fallback), not the source of truth for the UI.
INSERT INTO public.step_templates (name, description, step_type, parameter_schema, is_system)
VALUES
  (
    'Dispense',
    'Measure out a liquid to a target volume within tolerance — the volumetric counterpart of Weigh.',
    'dispense',
    '{"material_name": {"type": "string", "label": "Material Name"}, "target_volume": {"type": "number", "label": "Target Volume"}, "unit": {"type": "string", "label": "Unit", "default": "mL"}, "tolerance_pct": {"type": "number", "label": "Tolerance (%)", "default": 2}, "lot_controlled": {"type": "boolean", "label": "Lot Controlled"}}',
    true
  ),
  (
    'Stir / Vortex / Invert',
    'Agitate the solution by stirring, vortexing, or inverting for the specified time.',
    'agitate',
    '{"method": {"type": "string", "label": "Method", "options": ["Stir", "Vortex", "Invert", "Shake"], "default": "Stir"}, "duration_minutes": {"type": "number", "label": "Duration (minutes)", "default": 5}, "speed": {"type": "string", "label": "Speed", "options": ["low", "medium", "high"], "default": "medium"}}',
    true
  ),
  (
    'Freeze',
    'Freeze or transfer to frozen storage at the target temperature.',
    'freeze',
    '{"target_temp_c": {"type": "number", "label": "Target Temp (°C)", "default": -20}, "duration": {"type": "string", "label": "Duration / Until"}}',
    true
  ),
  (
    'Thaw',
    'Thaw the material — from frozen storage to the target temperature.',
    'thaw',
    '{"target_temp_c": {"type": "number", "label": "Target Temp (°C)", "default": 4}, "method": {"type": "string", "label": "Method"}, "until": {"type": "string", "label": "Thaw Until"}}',
    true
  ),
  (
    'Overnight Hold',
    'Hold or incubate the material overnight before the next step.',
    'overnight',
    '{"condition": {"type": "string", "label": "Condition / What Happens Overnight"}, "temp_c": {"type": "number", "label": "Temperature (°C)"}}',
    true
  ),
  (
    'Bring to Volume',
    'Q.S. / dilute the solution to its final volume with the specified diluent.',
    'bring_to_volume',
    '{"material_name": {"type": "string", "label": "Solution"}, "target_volume": {"type": "number", "label": "Final Volume"}, "unit": {"type": "string", "label": "Unit", "default": "mL"}, "diluent": {"type": "string", "label": "Diluent"}}',
    true
  ),
  (
    'Cap / Seal',
    'Cap, seal, or Parafilm the container.',
    'cap',
    '{"method": {"type": "string", "label": "Method", "options": ["Cap", "Screw cap", "Parafilm", "Seal", "Stopper"], "default": "Cap"}, "notes": {"type": "string", "label": "Notes"}}',
    true
  ),
  (
    'Package & Store',
    'Package the finished product into its container, label it, and route it to its storage / QC destination.',
    'package',
    '{"container": {"type": "string", "label": "Container"}, "label_ref": {"type": "string", "label": "Label Reference"}, "destination": {"type": "string", "label": "Destination"}, "notes": {"type": "string", "label": "Notes"}}',
    true
  )
ON CONFLICT DO NOTHING;
