-- ============================================================
-- Migration 033: Seed QC specification panels for the FG demo items
--   Adds realistic release-test panels (Appearance/Color [Pass/Fail], pH, Osmolality,
--   and where appropriate Assay / Specific gravity) to the finished-good
--   reagent items from migration 032 — so every demo recipe runs cleanly
--   through QC capture to a released Certificate of Quality.
--   Idempotent: a panel is only inserted if the item has no qc_tests yet.
-- Run in Supabase SQL Editor (after 032).
-- ============================================================

DO $$
DECLARE
  owner_id uuid;
  v_item   uuid;
BEGIN
  SELECT id INTO owner_id FROM public.profiles ORDER BY (role = 'admin') DESC, (role = 'author') DESC, created_at LIMIT 1;

  -- 1) PBS 1X pH 7.4
  SELECT id INTO v_item FROM public.reagent_items WHERE item_number = 'FG-PBS-1X';
  IF v_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.qc_tests WHERE reagent_item_id = v_item) THEN
    INSERT INTO public.qc_tests (reagent_item_id, test_order, name, unit, result_type, lower_limit, upper_limit, target, expected_text, method, created_by) VALUES
      (v_item, 0, 'Appearance / Color', NULL, 'passfail', NULL, NULL, NULL, 'Clear, colorless solution; free from visible particulates', 'Visual', owner_id),
      (v_item, 1, 'pH (25 C)', NULL, 'numeric', 7.30, 7.50, 7.40, NULL, 'USP <791>', owner_id),
      (v_item, 2, 'Osmolality', 'mOsm/kg', 'numeric', 270, 320, 290, NULL, 'USP <785> (freezing-point depression)', owner_id);
  END IF;

  -- 2) EDTA 0.5 M pH 8.0
  SELECT id INTO v_item FROM public.reagent_items WHERE item_number = 'FG-EDTA-05M';
  IF v_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.qc_tests WHERE reagent_item_id = v_item) THEN
    INSERT INTO public.qc_tests (reagent_item_id, test_order, name, unit, result_type, lower_limit, upper_limit, target, expected_text, method, created_by) VALUES
      (v_item, 0, 'Appearance / Color', NULL, 'passfail', NULL, NULL, NULL, 'Clear, colorless solution', 'Visual', owner_id),
      (v_item, 1, 'pH (25 C)', NULL, 'numeric', 7.90, 8.10, 8.00, NULL, 'USP <791>', owner_id),
      (v_item, 2, 'Osmolality', 'mOsm/kg', 'numeric', 1300, 1500, 1400, NULL, 'USP <785> (freezing-point depression)', owner_id),
      (v_item, 3, 'Assay (EDTA)', '% of nominal', 'numeric', 97.0, 103.0, 100.0, NULL, 'Complexometric titration', owner_id);
  END IF;

  -- 3) Tris-HCl 1 M pH 8.0
  SELECT id INTO v_item FROM public.reagent_items WHERE item_number = 'FG-TRIS-1M';
  IF v_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.qc_tests WHERE reagent_item_id = v_item) THEN
    INSERT INTO public.qc_tests (reagent_item_id, test_order, name, unit, result_type, lower_limit, upper_limit, target, expected_text, method, created_by) VALUES
      (v_item, 0, 'Appearance / Color', NULL, 'passfail', NULL, NULL, NULL, 'Clear, colorless solution', 'Visual', owner_id),
      (v_item, 1, 'pH (25 C)', NULL, 'numeric', 7.90, 8.10, 8.00, NULL, 'USP <791>, measured at 25 C', owner_id),
      (v_item, 2, 'Osmolality', 'mOsm/kg', 'numeric', 900, 1100, 1000, NULL, 'USP <785> (freezing-point depression)', owner_id);
  END IF;

  -- 4) SDS 10% (w/v)
  SELECT id INTO v_item FROM public.reagent_items WHERE item_number = 'FG-SDS-10';
  IF v_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.qc_tests WHERE reagent_item_id = v_item) THEN
    INSERT INTO public.qc_tests (reagent_item_id, test_order, name, unit, result_type, lower_limit, upper_limit, target, expected_text, method, created_by) VALUES
      (v_item, 0, 'Appearance / Color', NULL, 'passfail', NULL, NULL, NULL, 'Clear, colorless to pale-yellow solution; no precipitate', 'Visual', owner_id),
      (v_item, 1, 'pH (25 C)', NULL, 'numeric', 6.50, 8.50, 7.50, NULL, 'USP <791>', owner_id),
      (v_item, 2, 'Assay (SDS content)', '% w/v', 'numeric', 9.50, 10.50, 10.00, NULL, 'Two-phase titration', owner_id);
  END IF;

  -- 5) Ethanol 70% (v/v)
  SELECT id INTO v_item FROM public.reagent_items WHERE item_number = 'FG-ETOH-70';
  IF v_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.qc_tests WHERE reagent_item_id = v_item) THEN
    INSERT INTO public.qc_tests (reagent_item_id, test_order, name, unit, result_type, lower_limit, upper_limit, target, expected_text, method, created_by) VALUES
      (v_item, 0, 'Appearance / Color', NULL, 'passfail', NULL, NULL, NULL, 'Clear, colorless solution; no particulates', 'Visual', owner_id),
      (v_item, 1, 'Ethanol Content', '% v/v', 'numeric', 68.0, 72.0, 70.0, NULL, 'Gas chromatography', owner_id),
      (v_item, 2, 'Specific Gravity (20 C)', NULL, 'numeric', 0.883, 0.889, 0.886, NULL, 'USP <841>', owner_id);
  END IF;

  -- 6) Sodium Acetate 3 M pH 5.2
  SELECT id INTO v_item FROM public.reagent_items WHERE item_number = 'FG-NAOAC-3M';
  IF v_item IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.qc_tests WHERE reagent_item_id = v_item) THEN
    INSERT INTO public.qc_tests (reagent_item_id, test_order, name, unit, result_type, lower_limit, upper_limit, target, expected_text, method, created_by) VALUES
      (v_item, 0, 'Appearance / Color', NULL, 'passfail', NULL, NULL, NULL, 'Clear, colorless solution', 'Visual', owner_id),
      (v_item, 1, 'pH (25 C)', NULL, 'numeric', 5.10, 5.30, 5.20, NULL, 'USP <791>', owner_id),
      (v_item, 2, 'Osmolality', 'mOsm/kg', 'numeric', 3000, 3600, 3300, NULL, 'USP <785> (freezing-point depression)', owner_id);
  END IF;

END $$;
