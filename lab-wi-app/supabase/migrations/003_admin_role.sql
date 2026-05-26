-- ============================================================
-- Add 'admin' role to the profiles table constraint
-- Run in Supabase SQL Editor
-- ============================================================

-- Update the role check constraint to include 'admin'
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin', 'author', 'approver', 'operator'));

-- ----------------------------------------------------------------
-- Admin RLS policies — admin can do everything on all tables
-- Drop first to allow re-running safely
-- ----------------------------------------------------------------

DROP POLICY IF EXISTS "Admin full access to profiles"          ON public.profiles;
DROP POLICY IF EXISTS "Admin full access to materials"         ON public.materials;
DROP POLICY IF EXISTS "Admin full access to step templates"    ON public.step_templates;
DROP POLICY IF EXISTS "Admin full access to work instructions" ON public.work_instructions;
DROP POLICY IF EXISTS "Admin full access to wi steps"          ON public.wi_steps;
DROP POLICY IF EXISTS "Admin full access to wi approvals"      ON public.wi_approvals;
DROP POLICY IF EXISTS "Admin full access to production orders" ON public.production_orders;
DROP POLICY IF EXISTS "Admin full access to po steps"          ON public.po_steps;

-- PROFILES
CREATE POLICY "Admin full access to profiles"
  ON public.profiles FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- MATERIALS
CREATE POLICY "Admin full access to materials"
  ON public.materials FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- STEP TEMPLATES
CREATE POLICY "Admin full access to step templates"
  ON public.step_templates FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- WORK INSTRUCTIONS
CREATE POLICY "Admin full access to work instructions"
  ON public.work_instructions FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- WI STEPS
CREATE POLICY "Admin full access to wi steps"
  ON public.wi_steps FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- WI APPROVALS
CREATE POLICY "Admin full access to wi approvals"
  ON public.wi_approvals FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- PRODUCTION ORDERS
CREATE POLICY "Admin full access to production orders"
  ON public.production_orders FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- PO STEPS
CREATE POLICY "Admin full access to po steps"
  ON public.po_steps FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');
