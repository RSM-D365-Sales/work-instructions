-- ============================================================
-- Migration 032: Seed finished-good reagent items + link Work Instructions
--   Creates one FG (finished good) reagent item per demo recipe from
--   migration 031, then links each Work Instruction to its item via
--   work_instructions.reagent_item_id.
--   Finished goods are produced in-house and lot-controlled.
--   Idempotent: items keyed by item_number; links set by WI title.
-- Run in Supabase SQL Editor (after 031).
-- ============================================================

DO $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT id INTO owner_id FROM public.profiles ORDER BY (role = 'admin') DESC, (role = 'author') DESC, created_at LIMIT 1;

  -- Helper: insert an FG item if it does not already exist.
  -- (Inlined per item below for clarity / portability.)

  -- 1) PBS 1X pH 7.4
  IF NOT EXISTS (SELECT 1 FROM public.reagent_items WHERE item_number = 'FG-PBS-1X') THEN
    INSERT INTO public.reagent_items
      (item_number, product_name, search_name, item_type, unit_of_measure, lot_controlled, is_active,
       vendor, storage_conditions, hazard_class, ghs_pictograms, notes, created_by, updated_by)
    VALUES
      ('FG-PBS-1X', 'PBS 1X pH 7.4', 'PBS 1X pH 7.4', 'FG', 'L', true, true,
       'In-house Production', 'Room temperature', 'Non-hazardous', NULL,
       'Finished good produced in-house. Phosphate buffered saline, 1X.', owner_id, owner_id);
  END IF;
  UPDATE public.work_instructions
     SET reagent_item_id = (SELECT id FROM public.reagent_items WHERE item_number = 'FG-PBS-1X')
   WHERE title = '1X PBS (Phosphate Buffered Saline), pH 7.4';

  -- 2) EDTA 0.5 M pH 8.0
  IF NOT EXISTS (SELECT 1 FROM public.reagent_items WHERE item_number = 'FG-EDTA-05M') THEN
    INSERT INTO public.reagent_items
      (item_number, product_name, search_name, item_type, unit_of_measure, lot_controlled, is_active,
       vendor, storage_conditions, hazard_class, ghs_pictograms, notes, created_by, updated_by)
    VALUES
      ('FG-EDTA-05M', 'EDTA 0.5 M pH 8.0', 'EDTA 0.5 M pH 8.0', 'FG', 'L', true, true,
       'In-house Production', 'Room temperature', 'Irritant', ARRAY['GHS07'],
       'Finished good produced in-house. 0.5 M EDTA stock, pH 8.0.', owner_id, owner_id);
  END IF;
  UPDATE public.work_instructions
     SET reagent_item_id = (SELECT id FROM public.reagent_items WHERE item_number = 'FG-EDTA-05M')
   WHERE title = '0.5 M EDTA Solution, pH 8.0';

  -- 3) Tris-HCl 1 M pH 8.0
  IF NOT EXISTS (SELECT 1 FROM public.reagent_items WHERE item_number = 'FG-TRIS-1M') THEN
    INSERT INTO public.reagent_items
      (item_number, product_name, search_name, item_type, unit_of_measure, lot_controlled, is_active,
       vendor, storage_conditions, hazard_class, ghs_pictograms, notes, created_by, updated_by)
    VALUES
      ('FG-TRIS-1M', 'Tris-HCl 1 M pH 8.0', 'Tris-HCl 1 M pH 8.0', 'FG', 'L', true, true,
       'In-house Production', 'Room temperature', 'Irritant', ARRAY['GHS07'],
       'Finished good produced in-house. 1 M Tris-HCl buffer, pH 8.0 at 25 C.', owner_id, owner_id);
  END IF;
  UPDATE public.work_instructions
     SET reagent_item_id = (SELECT id FROM public.reagent_items WHERE item_number = 'FG-TRIS-1M')
   WHERE title = '1 M Tris-HCl Buffer, pH 8.0';

  -- 4) SDS 10% (w/v)
  IF NOT EXISTS (SELECT 1 FROM public.reagent_items WHERE item_number = 'FG-SDS-10') THEN
    INSERT INTO public.reagent_items
      (item_number, product_name, search_name, item_type, unit_of_measure, lot_controlled, is_active,
       vendor, storage_conditions, hazard_class, ghs_pictograms, notes, created_by, updated_by)
    VALUES
      ('FG-SDS-10', 'SDS 10% (w/v)', 'SDS 10% (w/v)', 'FG', 'L', true, true,
       'In-house Production', 'Room temperature', 'Irritant', ARRAY['GHS07'],
       'Finished good produced in-house. 10% w/v sodium dodecyl sulfate. Keep above 18 C to avoid precipitation.', owner_id, owner_id);
  END IF;
  UPDATE public.work_instructions
     SET reagent_item_id = (SELECT id FROM public.reagent_items WHERE item_number = 'FG-SDS-10')
   WHERE title = '10% (w/v) SDS Solution';

  -- 5) Ethanol 70% (v/v)
  IF NOT EXISTS (SELECT 1 FROM public.reagent_items WHERE item_number = 'FG-ETOH-70') THEN
    INSERT INTO public.reagent_items
      (item_number, product_name, search_name, item_type, unit_of_measure, lot_controlled, is_active,
       vendor, storage_conditions, hazard_class, ghs_pictograms, notes, created_by, updated_by)
    VALUES
      ('FG-ETOH-70', 'Ethanol 70% (v/v)', 'Ethanol 70% (v/v)', 'FG', 'L', true, true,
       'In-house Production', 'Flammables cabinet', 'Flammable', ARRAY['GHS02','GHS07'],
       'Finished good produced in-house. 70% v/v ethanol surface disinfectant. Flammable.', owner_id, owner_id);
  END IF;
  UPDATE public.work_instructions
     SET reagent_item_id = (SELECT id FROM public.reagent_items WHERE item_number = 'FG-ETOH-70')
   WHERE title = '70% (v/v) Ethanol Disinfectant';

  -- 6) Sodium Acetate 3 M pH 5.2
  IF NOT EXISTS (SELECT 1 FROM public.reagent_items WHERE item_number = 'FG-NAOAC-3M') THEN
    INSERT INTO public.reagent_items
      (item_number, product_name, search_name, item_type, unit_of_measure, lot_controlled, is_active,
       vendor, storage_conditions, hazard_class, ghs_pictograms, notes, created_by, updated_by)
    VALUES
      ('FG-NAOAC-3M', 'Sodium Acetate 3 M pH 5.2', 'Sodium Acetate 3 M pH 5.2', 'FG', 'L', true, true,
       'In-house Production', 'Room temperature', 'Non-hazardous', NULL,
       'Finished good produced in-house. 3 M sodium acetate, pH 5.2, for nucleic acid precipitation.', owner_id, owner_id);
  END IF;
  UPDATE public.work_instructions
     SET reagent_item_id = (SELECT id FROM public.reagent_items WHERE item_number = 'FG-NAOAC-3M')
   WHERE title = '3 M Sodium Acetate, pH 5.2';

END $$;
