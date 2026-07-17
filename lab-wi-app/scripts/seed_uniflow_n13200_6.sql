-- ============================================================
-- MIGRATED FROM UNIFLOW: N-13200-6 -- NSE Muscles Phosphate Buffer
-- ------------------------------------------------------------
--   The golden-example output for the Uniflow → Rocket Ship migration agent
--   (see UNIFLOW_TO_ROCKETSHIP_AGENT.md). Hand-written and validated against
--   the real schema so it can serve as the agent's few-shot target.
--
--   Source: 18 formParts → 12 wi_steps, 0 qc_tests.
--
--   Idempotent: drops any previously migrated WI with this title + item
--   before re-inserting. Safe to re-run.
--   Run in the Supabase SQL Editor (after migrations 001–048).
--
--   ⚠ NEEDS HUMAN REVIEW after running — see the notes at the bottom.
-- ============================================================

DO $$
DECLARE
  v_author uuid;
  v_item   uuid;
  v_wi     uuid;
  n        int := 0;   -- step_order counter
  v_clrw   text;       -- reagent_items.id values, as text, for the JSONB payloads
  v_naphos text;
  v_bottle text;
BEGIN
  -- Author to own the draft (authors can insert WIs; admins bypass RLS).
  SELECT id INTO v_author FROM public.profiles
   WHERE role IN ('author', 'admin')
   ORDER BY (role = 'author') DESC, created_at
   LIMIT 1;
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'No author/admin profile found to own the migrated work instruction.';
  END IF;

  -- ── 1. The finished good (item_number = Uniflow materialId) ──────────────
  INSERT INTO public.reagent_items
    (item_number, item_type, product_name, unit_of_measure, is_active, lot_controlled, notes)
  VALUES
    ('N-13200', 'FG', 'NSE Muscles Phosphate Buffer', 'mL', true, true,
     'Migrated from Uniflow — needs D365 item mapping')
  ON CONFLICT (item_number) DO UPDATE
    SET product_name = EXCLUDED.product_name, updated_at = now()
  RETURNING id INTO v_item;

  -- ── 2. Raw materials + packaging referenced by the steps ─────────────────
  -- item_number carries the Uniflow storeroom ID until a D365 mapping exists.
  INSERT INTO public.reagent_items
    (item_number, item_type, product_name, unit_of_measure, is_active, lot_controlled, notes)
  VALUES
    ('49534', 'RM',  'Clinical Laboratory Reagent Water (CLRW)', 'mL',        true, true,  'Migrated from Uniflow — needs D365 item mapping'),
    ('48516', 'RM',  'Sodium Phosphate, Dibasic',                'g',         true, true,  'Migrated from Uniflow — needs D365 item mapping'),
    ('48364', 'PKG', 'Bottle, Glass, 500mL',                     'Bottle(s)', true, false, 'Migrated from Uniflow — needs D365 item mapping')
  ON CONFLICT (item_number) DO NOTHING;

  SELECT id::text INTO v_clrw   FROM public.reagent_items WHERE item_number = '49534';
  SELECT id::text INTO v_naphos FROM public.reagent_items WHERE item_number = '48516';
  SELECT id::text INTO v_bottle FROM public.reagent_items WHERE item_number = '48364';

  -- ── 3. Idempotency: clear a previous migration of this WI ────────────────
  DELETE FROM public.work_instructions
   WHERE reagent_item_id = v_item
     AND title = 'NSE Muscles Phosphate Buffer'
     AND description LIKE 'Migrated from Uniflow%';   -- steps cascade

  -- ── 4. The work instruction (draft v1, Uniflow provenance kept) ──────────
  -- Rocket Ship version always starts at 1; the Uniflow version (6, parsed from
  -- materialVersionId 'N-13200-6') is preserved as provenance (migration 050).
  INSERT INTO public.work_instructions
    (title, description, product_name, reagent_item_id, version, status, scheduled_minutes,
     uniflow_material_id, uniflow_version_id, uniflow_version, created_by)
  VALUES
    ('NSE Muscles Phosphate Buffer',
     'Migrated from Uniflow N-13200-6.',
     'NSE Muscles Phosphate Buffer',
     v_item, 1, 'draft', 60,
     'N-13200', 'N-13200-6', 6,
     v_author)
  RETURNING id INTO v_wi;

  -- ── 5. Steps ─────────────────────────────────────────────────────────────

  -- [formParts_text_0 + formParts_attachments_1] → attachment
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'attachment' AND is_system LIMIT 1),
    n, 'Attach Supporting Documents', NULL,
    jsonb_build_object(
      '_step_type', 'attachment',
      'prompt',     'Attach the appropriate documents when needed.',
      'required',   false));

  -- [formParts_text_2 + formParts_materialNotWeighed_3] → gather_reagents
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'gather_reagents' AND is_system LIMIT 1),
    n, 'Add the chemical to CLRW while stirring', 'Add the chemical to CLRW while stirring.',
    jsonb_build_object(
      '_step_type', 'gather_reagents',
      'reagents',   jsonb_build_array(jsonb_build_object(
        'item_id',        v_clrw,
        'item_number',    '49534',
        'product_name',   'Clinical Laboratory Reagent Water (CLRW)',
        'quantity',       400,
        'unit',           'mL',
        'lot_controlled', true))));

  -- [formParts_materialWeighed_4] → weigh   ⚠ tolerance_pct defaulted to 2%
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'weigh' AND is_system LIMIT 1),
    n, 'Weigh Sodium Phosphate, Dibasic', 'Add the chemical to CLRW while stirring.',
    jsonb_build_object(
      '_step_type',     'weigh',
      'material_id',    v_naphos,
      'material_name',  'Sodium Phosphate, Dibasic',
      'target_weight',  14.2,
      'unit',           'g',
      'tolerance_pct',  2,
      'lot_controlled', true));

  -- [formParts_text_5 + formParts_materialNoQty_6] → gather_reagents (Q.S., no qty)
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'gather_reagents' AND is_system LIMIT 1),
    n, 'Q.S. the solution to 500 mL with CLRW', 'Q.S. the solution to 500 mL with CLRW.',
    jsonb_build_object(
      '_step_type', 'gather_reagents',
      'reagents',   jsonb_build_array(jsonb_build_object(
        'item_id',        v_clrw,
        'item_number',    '49534',
        'product_name',   'Clinical Laboratory Reagent Water (CLRW)',
        'quantity',       null,
        'unit',           'mL',
        'lot_controlled', true))));

  -- [formParts_text_7 + formParts_materialNotWeighed_8] → gather_reagents
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'gather_reagents' AND is_system LIMIT 1),
    n, 'Transfer the solution to a labeled bottle', 'Transfer the solution to a labeled bottle.',
    jsonb_build_object(
      '_step_type', 'gather_reagents',
      'reagents',   jsonb_build_array(jsonb_build_object(
        'item_id',        v_bottle,
        'item_number',    '48364',
        'product_name',   'Bottle, Glass, 500mL',
        'quantity',       1,
        'unit',           'Bottle(s)',
        'lot_controlled', false))));

  -- [formParts_text_9] standalone → custom
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'custom' AND is_system LIMIT 1),
    n, 'Deliver to the 15-30°C QC area', NULL,
    jsonb_build_object(
      '_step_type',       'custom',
      'instruction_text', 'Deliver to the 15-30°C QC area.'));

  -- [formParts_separator_10 + formParts_separatorDay1_11] → one production_break
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'production_break' AND is_system LIMIT 1),
    n, 'QC Instructions — Day 1', NULL,
    jsonb_build_object(
      '_step_type',  'production_break',
      'label',       'QC Instructions — Day 1',
      'description', 'Everything below is performed by QC on Day 1.'));

  -- [formParts_text_12 … text_15] → custom × 4
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'custom' AND is_system LIMIT 1),
    n, 'Verify that the documentation is complete', NULL,
    jsonb_build_object('_step_type', 'custom', 'instruction_text', 'Verify that the documentation is complete.'));

  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'custom' AND is_system LIMIT 1),
    n, 'Verify label matches the product', NULL,
    jsonb_build_object('_step_type', 'custom', 'instruction_text', 'Verify label matches the product.'));

  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'custom' AND is_system LIMIT 1),
    n, 'Verify volume of product', NULL,
    jsonb_build_object('_step_type', 'custom', 'instruction_text', 'Verify volume of product.'));

  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'custom' AND is_system LIMIT 1),
    n, 'Verify that the proper container was used', NULL,
    jsonb_build_object('_step_type', 'custom', 'instruction_text', 'Verify that the proper container was used.'));

  -- [formParts_text_16 + formParts_defectRate_17] → observe
  n := n + 1;
  INSERT INTO public.wi_steps (work_instruction_id, step_template_id, step_order, name, description, parameters)
  VALUES (v_wi,
    (SELECT id FROM public.step_templates WHERE step_type = 'observe' AND is_system LIMIT 1),
    n, 'Record defects', NULL,
    jsonb_build_object(
      '_step_type', 'observe',
      'prompt',     'Record the number of defects found during QC review.'));

  -- ── 6. QC specifications ─────────────────────────────────────────────────
  -- None: N-13200-6 has no pHMeter or osmolarity formPart. (E-81000-14 would
  -- insert qc_tests rows for pH and Osmolality here.)

  RAISE NOTICE 'Migrated N-13200-6 → work_instruction % with % steps', v_wi, n;
END $$;

-- ── Verification ──────────────────────────────────────────────────────────────
SELECT wi.title, wi.version, wi.status, ri.item_number, count(s.id) AS steps
  FROM public.work_instructions wi
  JOIN public.reagent_items ri ON ri.id = wi.reagent_item_id
  LEFT JOIN public.wi_steps s ON s.work_instruction_id = wi.id
 WHERE ri.item_number = 'N-13200'
 GROUP BY wi.title, wi.version, wi.status, ri.item_number;

-- The migrated step list, in order:
SELECT s.step_order, s.parameters->>'_step_type' AS step_type, s.name
  FROM public.wi_steps s
  JOIN public.work_instructions wi ON wi.id = s.work_instruction_id
  JOIN public.reagent_items ri ON ri.id = wi.reagent_item_id
 WHERE ri.item_number = 'N-13200'
 ORDER BY s.step_order;

-- Materials checksum — every row from the Uniflow Materials table must appear:
--   48364 Bottle, Glass, 500mL   1.0 Bottle(s)   → step 5
--   48516 Sodium Phosphate, Dibasic  14.2 g      → step 3 (weigh)
--   49534 CLRW  500.0 mL  (400 mL + Q.S. to 500) → steps 2 + 4
SELECT item_number, item_type, product_name, unit_of_measure, lot_controlled
  FROM public.reagent_items
 WHERE item_number IN ('N-13200', '49534', '48516', '48364')
 ORDER BY item_type, item_number;

-- ── NEEDS HUMAN REVIEW ────────────────────────────────────────────────────────
--  1. weigh "Sodium Phosphate, Dibasic" — tolerance_pct defaulted to 2%. Uniflow
--     carries no tolerance. Out-of-tolerance BLOCKS step completion, so confirm
--     this with the reagent lab before approving.
--  2. scheduled_minutes = 60 is an estimate (Uniflow processingTime not mapped).
--  3. reagent_items N-13200 (FG) / 49534 / 48516 / 48364 were created with Uniflow
--     storeroom IDs as item_number — they need a D365 item mapping pass.
--  4. Step 4 (Q.S.) has quantity = null; the "to 500 mL" target lives in the step
--     name only. Rocket Ship has no Q.S. step type.
--  5. The WI is status='draft' — route it through the normal approval workflow.
