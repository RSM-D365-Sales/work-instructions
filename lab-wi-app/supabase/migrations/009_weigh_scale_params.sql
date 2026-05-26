-- ============================================================
-- Migration 009: Add scale_id / scale_name to Weigh step template
-- Updates the system Weigh template schema so the editor and
-- execution page know about these two new parameters.
-- ============================================================

update public.step_templates
set parameter_schema = '{
  "material_id":   { "type": "string", "label": "Material (from Reagent Items)" },
  "material_name": { "type": "string", "label": "Material Name", "required": true },
  "scale_id":      { "type": "string", "label": "Scale" },
  "scale_name":    { "type": "string", "label": "Scale Name" },
  "target_weight": { "type": "number", "label": "Target Weight", "required": true },
  "unit":          { "type": "string", "label": "Unit", "options": ["g","kg","mg","mL","L"] },
  "tolerance_pct": { "type": "number", "label": "Tolerance (%)", "default": 2.0 }
}'::jsonb
where name = 'Weigh'
  and is_system = true;
