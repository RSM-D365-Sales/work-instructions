-- Migration 005: Fix RLS visibility gaps
-- Run in Supabase SQL Editor

-- 1. Work instructions SELECT: admins and approvers must also see pending_review WIs
--    they did not create (so they can approve them).
--    Re-create the policy to include admin role explicitly.
DROP POLICY IF EXISTS "All authenticated users can read approved WIs" ON public.work_instructions;

CREATE POLICY "All authenticated users can read accessible WIs"
  ON public.work_instructions FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (
      status = 'approved'
      OR created_by = auth.uid()
      OR public.current_user_role() IN ('approver', 'admin')
    )
  );

-- 2. WI steps SELECT: admin must also see steps of any WI (needed for approval review)
DROP POLICY IF EXISTS "Users can read steps of accessible WIs" ON public.wi_steps;

CREATE POLICY "Users can read steps of accessible WIs"
  ON public.wi_steps FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.work_instructions wi
      WHERE wi.id = work_instruction_id
        AND (
          wi.status = 'approved'
          OR wi.created_by = auth.uid()
          OR public.current_user_role() IN ('approver', 'admin')
        )
    )
  );

-- 3. Work instructions UPDATE: admin already covered by migration 003, but the
--    original approver policy restricts to status IN ('pending_review','approved').
--    Ensure approver policy is intact (no change needed — 003 admin policy covers admin).

-- 4. wi_approvals INSERT: allow admin to insert approval records
DROP POLICY IF EXISTS "Approvers can insert approval records" ON public.wi_approvals;

CREATE POLICY "Approvers and admins can insert approval records"
  ON public.wi_approvals FOR INSERT WITH CHECK (
    public.current_user_role() IN ('approver', 'author', 'admin')
    AND reviewer_id = auth.uid()
  );
