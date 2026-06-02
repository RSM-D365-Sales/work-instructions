-- ============================================================
-- Migration 031: Seed demo Work Instructions
--   Adds a set of realistic, APPROVED reagent-lab recipes so the
--   Work Instructions page (and Production Orders) are populated for demos.
--   Each WI is owned by an author and approved by an approver (resolved
--   from existing profiles), version 1, status 'approved'.
--   Idempotent: each WI is only inserted if its title does not exist.
-- Run in Supabase SQL Editor.
-- ============================================================

DO $$
DECLARE
  author_id   uuid;
  approver_id uuid;
  v_wi        uuid;
BEGIN
  -- Resolve a creator (prefer author, then admin, then anyone) and an approver.
  SELECT id INTO author_id   FROM public.profiles ORDER BY (role = 'author')   DESC, (role = 'admin') DESC, created_at LIMIT 1;
  SELECT id INTO approver_id FROM public.profiles ORDER BY (role = 'approver') DESC, (role = 'admin') DESC, created_at LIMIT 1;
  IF approver_id IS NULL THEN approver_id := author_id; END IF;

  -- ── WI 1: 1X PBS, pH 7.4 ─────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.work_instructions WHERE title = '1X PBS (Phosphate Buffered Saline), pH 7.4') THEN
    INSERT INTO public.work_instructions
      (title, description, product_name, target_molarity, scheduled_minutes, version, status, created_by, approved_by, approved_at)
    VALUES
      ('1X PBS (Phosphate Buffered Saline), pH 7.4', 'Standard 1X phosphate buffered saline for cell rinse and general lab use.', 'PBS 1X pH 7.4', NULL, 45, 1, 'approved', author_id, approver_id, now())
    RETURNING id INTO v_wi;
    INSERT INTO public.wi_steps (work_instruction_id, step_order, name, description, parameters) VALUES
      (v_wi, 1, 'Gather Inputs', 'Collect reagents and DI water', '{"_step_type":"gather_inputs","inputs":[{"material_name":"Sodium Chloride (NaCl)","quantity":8,"unit":"g"},{"material_name":"Potassium Chloride (KCl)","quantity":0.2,"unit":"g"},{"material_name":"Sodium Phosphate Dibasic (Na2HPO4)","quantity":1.44,"unit":"g"},{"material_name":"Potassium Phosphate Monobasic (KH2PO4)","quantity":0.24,"unit":"g"},{"material_name":"Deionised Water","quantity":1000,"unit":"mL"}]}'::jsonb),
      (v_wi, 2, 'Weigh Sodium Chloride', 'Weigh NaCl to target', '{"_step_type":"weigh","material_name":"Sodium Chloride (NaCl)","target_weight":8,"unit":"g","tolerance_pct":2}'::jsonb),
      (v_wi, 3, 'Weigh Sodium Phosphate Dibasic', 'Weigh Na2HPO4 to target', '{"_step_type":"weigh","material_name":"Sodium Phosphate Dibasic (Na2HPO4)","target_weight":1.44,"unit":"g","tolerance_pct":2}'::jsonb),
      (v_wi, 4, 'Transfer to Mixing Vessel', 'Add solids and ~800 mL water', '{"_step_type":"transfer","from_vessel":"Weigh Bench","to_vessel":"Mixing Vessel 1"}'::jsonb),
      (v_wi, 5, 'Mix to Dissolve', 'Stir until fully dissolved', '{"_step_type":"mix","duration_minutes":10,"speed":"medium"}'::jsonb),
      (v_wi, 6, 'pH Adjust to 7.4', 'Adjust with 1M HCl', '{"_step_type":"ph_adjust","target_ph":7.4,"tolerance":0.05,"reagent":"1M HCl"}'::jsonb),
      (v_wi, 7, 'Bring to Volume', 'Top up to 1 L with DI water', '{"_step_type":"transfer","from_vessel":"Mixing Vessel 1","to_vessel":"1 L Volumetric Flask"}'::jsonb),
      (v_wi, 8, 'Final Inspection', 'Confirm clarity', '{"_step_type":"observe","prompt":"Confirm the solution is clear and colorless with no particulates."}'::jsonb),
      (v_wi, 9, 'Print Labels', 'Product and lot labels', '{"_step_type":"print_labels","label_template":"Product Label","quantity":1,"notes":"Include lot number and expiry date."}'::jsonb);
  END IF;

  -- ── WI 2: 0.5 M EDTA, pH 8.0 ─────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.work_instructions WHERE title = '0.5 M EDTA Solution, pH 8.0') THEN
    INSERT INTO public.work_instructions
      (title, description, product_name, target_molarity, scheduled_minutes, version, status, created_by, approved_by, approved_at)
    VALUES
      ('0.5 M EDTA Solution, pH 8.0', 'Stock 0.5 M EDTA. EDTA dissolves only as the pH approaches 8.0.', 'EDTA 0.5 M pH 8.0', 0.5, 60, 1, 'approved', author_id, approver_id, now())
    RETURNING id INTO v_wi;
    INSERT INTO public.wi_steps (work_instruction_id, step_order, name, description, parameters) VALUES
      (v_wi, 1, 'Gather Inputs', 'Collect reagents and DI water', '{"_step_type":"gather_inputs","inputs":[{"material_name":"EDTA Disodium Dihydrate","quantity":186.1,"unit":"g"},{"material_name":"Sodium Hydroxide (NaOH) pellets","quantity":20,"unit":"g"},{"material_name":"Deionised Water","quantity":1000,"unit":"mL"}]}'::jsonb),
      (v_wi, 2, 'Weigh EDTA Disodium', 'Weigh EDTA to target', '{"_step_type":"weigh","material_name":"EDTA Disodium Dihydrate","target_weight":186.1,"unit":"g","tolerance_pct":1}'::jsonb),
      (v_wi, 3, 'Transfer to Mixing Vessel', 'Add EDTA and ~800 mL water', '{"_step_type":"transfer","from_vessel":"Weigh Bench","to_vessel":"Mixing Vessel 1"}'::jsonb),
      (v_wi, 4, 'Mix While Adjusting', 'Stir continuously', '{"_step_type":"mix","duration_minutes":15,"speed":"medium"}'::jsonb),
      (v_wi, 5, 'pH Adjust to 8.0', 'Raise pH with 10M NaOH until dissolved', '{"_step_type":"ph_adjust","target_ph":8.0,"tolerance":0.05,"reagent":"10M NaOH"}'::jsonb),
      (v_wi, 6, 'Final Inspection', 'Confirm fully dissolved', '{"_step_type":"observe","prompt":"Confirm all EDTA has dissolved and the solution is clear."}'::jsonb),
      (v_wi, 7, 'Bring to Volume', 'Top up to 1 L with DI water', '{"_step_type":"transfer","from_vessel":"Mixing Vessel 1","to_vessel":"1 L Volumetric Flask"}'::jsonb),
      (v_wi, 8, 'Print Labels', 'Product and lot labels', '{"_step_type":"print_labels","label_template":"Product Label","quantity":1,"notes":"Include lot number and expiry date."}'::jsonb);
  END IF;

  -- ── WI 3: 1 M Tris-HCl, pH 8.0 ───────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.work_instructions WHERE title = '1 M Tris-HCl Buffer, pH 8.0') THEN
    INSERT INTO public.work_instructions
      (title, description, product_name, target_molarity, scheduled_minutes, version, status, created_by, approved_by, approved_at)
    VALUES
      ('1 M Tris-HCl Buffer, pH 8.0', 'Stock 1 M Tris buffer. pH is temperature sensitive — adjust at 25 C.', 'Tris-HCl 1 M pH 8.0', 1, 50, 1, 'approved', author_id, approver_id, now())
    RETURNING id INTO v_wi;
    INSERT INTO public.wi_steps (work_instruction_id, step_order, name, description, parameters) VALUES
      (v_wi, 1, 'Gather Inputs', 'Collect reagents and DI water', '{"_step_type":"gather_inputs","inputs":[{"material_name":"Tris Base","quantity":121.1,"unit":"g"},{"material_name":"Hydrochloric Acid (6M)","quantity":420,"unit":"mL"},{"material_name":"Deionised Water","quantity":1000,"unit":"mL"}]}'::jsonb),
      (v_wi, 2, 'Weigh Tris Base', 'Weigh Tris to target', '{"_step_type":"weigh","material_name":"Tris Base","target_weight":121.1,"unit":"g","tolerance_pct":1}'::jsonb),
      (v_wi, 3, 'Transfer to Mixing Vessel', 'Add Tris and ~800 mL water', '{"_step_type":"transfer","from_vessel":"Weigh Bench","to_vessel":"Mixing Vessel 1"}'::jsonb),
      (v_wi, 4, 'Mix to Dissolve', 'Stir until dissolved', '{"_step_type":"mix","duration_minutes":10,"speed":"medium"}'::jsonb),
      (v_wi, 5, 'Equilibrate to 25 C', 'Allow solution to reach 25 C before pH', '{"_step_type":"cool","target_temp_c":25}'::jsonb),
      (v_wi, 6, 'pH Adjust to 8.0', 'Adjust with 6M HCl', '{"_step_type":"ph_adjust","target_ph":8.0,"tolerance":0.05,"reagent":"6M HCl"}'::jsonb),
      (v_wi, 7, 'Bring to Volume', 'Top up to 1 L with DI water', '{"_step_type":"transfer","from_vessel":"Mixing Vessel 1","to_vessel":"1 L Volumetric Flask"}'::jsonb),
      (v_wi, 8, 'Final Inspection', 'Confirm clarity', '{"_step_type":"observe","prompt":"Confirm the buffer is clear and colorless."}'::jsonb),
      (v_wi, 9, 'Print Labels', 'Product and lot labels', '{"_step_type":"print_labels","label_template":"Product Label","quantity":1,"notes":"Include lot number and expiry date."}'::jsonb);
  END IF;

  -- ── WI 4: 10% (w/v) SDS Solution ─────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.work_instructions WHERE title = '10% (w/v) SDS Solution') THEN
    INSERT INTO public.work_instructions
      (title, description, product_name, target_molarity, scheduled_minutes, version, status, created_by, approved_by, approved_at)
    VALUES
      ('10% (w/v) SDS Solution', 'Sodium dodecyl sulfate stock. Wear a mask when weighing — fine dust irritant. Mix gently to avoid foaming.', 'SDS 10% (w/v)', NULL, 40, 1, 'approved', author_id, approver_id, now())
    RETURNING id INTO v_wi;
    INSERT INTO public.wi_steps (work_instruction_id, step_order, name, description, parameters) VALUES
      (v_wi, 1, 'Gather Inputs', 'Collect reagents and DI water', '{"_step_type":"gather_inputs","inputs":[{"material_name":"Sodium Dodecyl Sulfate (SDS)","quantity":100,"unit":"g"},{"material_name":"Deionised Water","quantity":1000,"unit":"mL"}]}'::jsonb),
      (v_wi, 2, 'Weigh SDS', 'Weigh SDS to target — mask required', '{"_step_type":"weigh","material_name":"Sodium Dodecyl Sulfate (SDS)","target_weight":100,"unit":"g","tolerance_pct":2}'::jsonb),
      (v_wi, 3, 'Transfer to Mixing Vessel', 'Add SDS and ~800 mL water', '{"_step_type":"transfer","from_vessel":"Weigh Bench","to_vessel":"Mixing Vessel 1"}'::jsonb),
      (v_wi, 4, 'Gentle Heat to Dissolve', 'Warm to 50 C to aid dissolution', '{"_step_type":"heat","target_temp_c":50,"duration_minutes":20}'::jsonb),
      (v_wi, 5, 'Mix Slowly', 'Low speed to avoid foaming', '{"_step_type":"mix","duration_minutes":15,"speed":"low"}'::jsonb),
      (v_wi, 6, 'Final Inspection', 'Confirm dissolved', '{"_step_type":"observe","prompt":"Confirm the solution is clear with no undissolved powder."}'::jsonb),
      (v_wi, 7, 'Bring to Volume', 'Top up to 1 L with DI water', '{"_step_type":"transfer","from_vessel":"Mixing Vessel 1","to_vessel":"1 L Volumetric Flask"}'::jsonb),
      (v_wi, 8, 'Print Labels', 'Product and lot labels', '{"_step_type":"print_labels","label_template":"Product Label","quantity":1,"notes":"Include lot number and expiry date."}'::jsonb);
  END IF;

  -- ── WI 5: 70% (v/v) Ethanol Disinfectant ─────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.work_instructions WHERE title = '70% (v/v) Ethanol Disinfectant') THEN
    INSERT INTO public.work_instructions
      (title, description, product_name, target_molarity, scheduled_minutes, version, status, created_by, approved_by, approved_at)
    VALUES
      ('70% (v/v) Ethanol Disinfectant', 'General-purpose 70% ethanol surface disinfectant. Volumetric prep — no weighing. Flammable; prepare away from ignition sources.', 'Ethanol 70% (v/v)', NULL, 30, 1, 'approved', author_id, approver_id, now())
    RETURNING id INTO v_wi;
    INSERT INTO public.wi_steps (work_instruction_id, step_order, name, description, parameters) VALUES
      (v_wi, 1, 'Gather Inputs', 'Collect ethanol and DI water', '{"_step_type":"gather_inputs","inputs":[{"material_name":"Absolute Ethanol (200 proof)","quantity":700,"unit":"mL"},{"material_name":"Deionised Water","quantity":300,"unit":"mL"}]}'::jsonb),
      (v_wi, 2, 'Measure Ethanol', 'Add 700 mL ethanol to vessel', '{"_step_type":"transfer","from_vessel":"Ethanol Drum","to_vessel":"Mixing Vessel 1"}'::jsonb),
      (v_wi, 3, 'Add DI Water', 'Add 300 mL DI water', '{"_step_type":"transfer","from_vessel":"DI Water Tap","to_vessel":"Mixing Vessel 1"}'::jsonb),
      (v_wi, 4, 'Mix', 'Blend thoroughly', '{"_step_type":"mix","duration_minutes":5,"speed":"low"}'::jsonb),
      (v_wi, 5, 'Final Inspection', 'Confirm homogeneous', '{"_step_type":"observe","prompt":"Confirm the solution is clear and well mixed."}'::jsonb),
      (v_wi, 6, 'Print Labels', 'Product and lot labels', '{"_step_type":"print_labels","label_template":"Product Label","quantity":4,"notes":"Flammable label required. Include lot number."}'::jsonb);
  END IF;

  -- ── WI 6: 3 M Sodium Acetate, pH 5.2 ─────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM public.work_instructions WHERE title = '3 M Sodium Acetate, pH 5.2') THEN
    INSERT INTO public.work_instructions
      (title, description, product_name, target_molarity, scheduled_minutes, version, status, created_by, approved_by, approved_at)
    VALUES
      ('3 M Sodium Acetate, pH 5.2', 'Stock 3 M sodium acetate for nucleic acid precipitation.', 'Sodium Acetate 3 M pH 5.2', 3, 45, 1, 'approved', author_id, approver_id, now())
    RETURNING id INTO v_wi;
    INSERT INTO public.wi_steps (work_instruction_id, step_order, name, description, parameters) VALUES
      (v_wi, 1, 'Gather Inputs', 'Collect reagents and DI water', '{"_step_type":"gather_inputs","inputs":[{"material_name":"Sodium Acetate Trihydrate","quantity":408.1,"unit":"g"},{"material_name":"Glacial Acetic Acid","quantity":100,"unit":"mL"},{"material_name":"Deionised Water","quantity":1000,"unit":"mL"}]}'::jsonb),
      (v_wi, 2, 'Weigh Sodium Acetate', 'Weigh sodium acetate trihydrate', '{"_step_type":"weigh","material_name":"Sodium Acetate Trihydrate","target_weight":408.1,"unit":"g","tolerance_pct":1}'::jsonb),
      (v_wi, 3, 'Transfer to Mixing Vessel', 'Add solids and ~700 mL water', '{"_step_type":"transfer","from_vessel":"Weigh Bench","to_vessel":"Mixing Vessel 1"}'::jsonb),
      (v_wi, 4, 'Mix to Dissolve', 'Stir until dissolved', '{"_step_type":"mix","duration_minutes":10,"speed":"medium"}'::jsonb),
      (v_wi, 5, 'pH Adjust to 5.2', 'Adjust with glacial acetic acid', '{"_step_type":"ph_adjust","target_ph":5.2,"tolerance":0.05,"reagent":"Glacial Acetic Acid"}'::jsonb),
      (v_wi, 6, 'Bring to Volume', 'Top up to 1 L with DI water', '{"_step_type":"transfer","from_vessel":"Mixing Vessel 1","to_vessel":"1 L Volumetric Flask"}'::jsonb),
      (v_wi, 7, 'Final Inspection', 'Confirm clarity', '{"_step_type":"observe","prompt":"Confirm the solution is clear and colorless."}'::jsonb),
      (v_wi, 8, 'Print Labels', 'Product and lot labels', '{"_step_type":"print_labels","label_template":"Product Label","quantity":1,"notes":"Include lot number and expiry date."}'::jsonb);
  END IF;

END $$;
