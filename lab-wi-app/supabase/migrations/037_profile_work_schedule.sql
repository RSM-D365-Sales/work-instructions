-- ============================================================
-- Migration 037: Per-user weekly working pattern
--   Adds profiles.work_schedule — a 7-element JSON array indexed by weekday
--   (0 = Sunday … 6 = Saturday), each value one of:
--     'work' — a normal working day
--     'off'  — not working that day (shown greyed / struck through)
--     'pto'  — scheduled time off (shown in a "happy" colour)
--   NULL means no schedule set yet → treated as all working days.
--   Admins manage this on the User Management page (existing
--   "Admin full access to profiles" RLS policy already permits updates).
--   Idempotent. Run in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS work_schedule jsonb;
