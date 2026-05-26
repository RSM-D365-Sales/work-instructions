-- ============================================================
-- Row Level Security Policies
-- ============================================================

-- Enable RLS on all tables
alter table public.profiles          enable row level security;
alter table public.materials         enable row level security;
alter table public.step_templates    enable row level security;
alter table public.work_instructions enable row level security;
alter table public.wi_steps          enable row level security;
alter table public.wi_approvals      enable row level security;
alter table public.production_orders enable row level security;
alter table public.po_steps          enable row level security;

-- Helper: get current user role
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ----------------------------------------------------------------
-- PROFILES
-- ----------------------------------------------------------------
create policy "Users can read all profiles"
  on public.profiles for select using (auth.uid() is not null);

create policy "Users can update own profile"
  on public.profiles for update using (id = auth.uid());

-- ----------------------------------------------------------------
-- MATERIALS — all authenticated users can read; authors can write
-- ----------------------------------------------------------------
create policy "Authenticated users can read materials"
  on public.materials for select using (auth.uid() is not null);

create policy "Authors can insert materials"
  on public.materials for insert with check (
    public.current_user_role() in ('author', 'approver')
  );

create policy "Authors can update materials"
  on public.materials for update using (
    public.current_user_role() in ('author', 'approver')
  );

-- ----------------------------------------------------------------
-- STEP TEMPLATES — all authenticated users can read; authors can write non-system
-- ----------------------------------------------------------------
create policy "Authenticated users can read step templates"
  on public.step_templates for select using (auth.uid() is not null);

create policy "Authors can insert step templates"
  on public.step_templates for insert with check (
    public.current_user_role() in ('author', 'approver') and is_system = false
  );

create policy "Authors can update own non-system step templates"
  on public.step_templates for update using (
    public.current_user_role() in ('author', 'approver')
    and is_system = false
    and created_by = auth.uid()
  );

create policy "Authors can delete own non-system step templates"
  on public.step_templates for delete using (
    is_system = false and created_by = auth.uid()
  );

-- ----------------------------------------------------------------
-- WORK INSTRUCTIONS
-- ----------------------------------------------------------------
create policy "All authenticated users can read approved WIs"
  on public.work_instructions for select using (
    auth.uid() is not null
    and (status = 'approved' or created_by = auth.uid() or public.current_user_role() in ('approver'))
  );

create policy "Authors can create WIs"
  on public.work_instructions for insert with check (
    public.current_user_role() = 'author'
  );

create policy "Authors can update own draft WIs"
  on public.work_instructions for update using (
    created_by = auth.uid()
    and status in ('draft', 'rejected')
  );

create policy "Approvers can update WI status"
  on public.work_instructions for update using (
    public.current_user_role() = 'approver'
    and status in ('pending_review', 'approved')
  );

-- ----------------------------------------------------------------
-- WI STEPS
-- ----------------------------------------------------------------
create policy "Users can read steps of accessible WIs"
  on public.wi_steps for select using (
    exists (
      select 1 from public.work_instructions wi
      where wi.id = work_instruction_id
        and (wi.status = 'approved' or wi.created_by = auth.uid() or public.current_user_role() in ('approver'))
    )
  );

create policy "Authors can manage steps of own draft WIs"
  on public.wi_steps for all using (
    exists (
      select 1 from public.work_instructions wi
      where wi.id = work_instruction_id
        and wi.created_by = auth.uid()
        and wi.status in ('draft', 'rejected')
    )
  );

-- ----------------------------------------------------------------
-- WI APPROVALS
-- ----------------------------------------------------------------
create policy "Authenticated users can read approvals"
  on public.wi_approvals for select using (auth.uid() is not null);

create policy "Approvers can insert approval records"
  on public.wi_approvals for insert with check (
    public.current_user_role() in ('approver', 'author')
    and reviewer_id = auth.uid()
  );

-- ----------------------------------------------------------------
-- PRODUCTION ORDERS
-- ----------------------------------------------------------------
create policy "Authenticated users can read production orders"
  on public.production_orders for select using (auth.uid() is not null);

create policy "Operators and authors can create production orders"
  on public.production_orders for insert with check (
    public.current_user_role() in ('operator', 'author', 'approver')
  );

create policy "Assigned operator or creator can update production order"
  on public.production_orders for update using (
    created_by = auth.uid()
    or assigned_to = auth.uid()
    or public.current_user_role() in ('author', 'approver')
  );

-- ----------------------------------------------------------------
-- PO STEPS (execution log)
-- ----------------------------------------------------------------
create policy "Authenticated users can read po steps"
  on public.po_steps for select using (auth.uid() is not null);

create policy "Operators can insert po step records"
  on public.po_steps for insert with check (
    auth.uid() is not null
  );

create policy "Operators can update po steps they own"
  on public.po_steps for update using (
    operator_id = auth.uid()
    or public.current_user_role() in ('author', 'approver')
  );
