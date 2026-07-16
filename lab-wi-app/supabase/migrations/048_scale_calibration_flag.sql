-- Migration 048: Flag-for-calibration on scales/equipment (Epic B4)
--
-- Quality Trends gains "by user" and "by instrument" pivots; the instrument
-- pivot lets an admin flag a piece of equipment for calibration when its
-- results trend toward spec. The flag lives on the scales table (the app's
-- equipment master) and surfaces on the Scales page, where an admin clears
-- it with "Mark calibrated" (stamping last_calibrated_at). Feeds A4
-- (equipment-aware scheduling) later.
--
-- Additive only — no RLS changes needed: scales_read already lets everyone
-- see the flag, and scales_admin_write (008) already restricts flag/clear
-- writes to admins, which matches the B4 acceptance criteria.
-- Run in the Supabase SQL Editor.

ALTER TABLE public.scales
  ADD COLUMN IF NOT EXISTS calibration_flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS calibration_flagged_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS calibration_flag_reason text,
  ADD COLUMN IF NOT EXISTS last_calibrated_at timestamptz;
