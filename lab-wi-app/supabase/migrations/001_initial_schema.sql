-- ============================================================
-- Lab Work Instructions System — Initial Schema
-- ============================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------
-- PROFILES (extends Supabase auth.users)
-- ----------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  role       text not null default 'operator'
               check (role in ('author', 'approver', 'operator')),
  created_at timestamptz not null default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'operator')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ----------------------------------------------------------------
-- MATERIALS (reagents / raw inputs)
-- ----------------------------------------------------------------
create table public.materials (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  unit        text not null default 'g',   -- g, mL, mol, etc.
  cas_number  text,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id)
);

-- ----------------------------------------------------------------
-- STEP TEMPLATES (reusable step types)
-- ----------------------------------------------------------------
-- step_type controls which execution widget is rendered
-- parameter_schema is a JSONB definition of configurable fields
--
-- Built-in step types:
--   gather_inputs   — list of materials to collect
--   weigh           — weigh an input to a target ± tolerance
--   mix             — mix for a specified duration
--   transfer        — transfer solution between vessels
--   ph_adjust       — adjust pH to target
--   heat            — heat to temperature for duration
--   cool            — cool to temperature
--   observe         — record a free-text observation
--   custom          — generic step with free text

create table public.step_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  step_type        text not null default 'custom'
                     check (step_type in (
                       'gather_inputs','weigh','mix','transfer',
                       'ph_adjust','heat','cool','observe','custom'
                     )),
  parameter_schema jsonb not null default '{}',
  is_system        boolean not null default false,   -- system templates can't be deleted
  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id)
);

-- ----------------------------------------------------------------
-- WORK INSTRUCTIONS
-- ----------------------------------------------------------------
create table public.work_instructions (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  product_name  text not null,
  target_molarity numeric,
  version       integer not null default 1,
  status        text not null default 'draft'
                  check (status in ('draft','pending_review','approved','rejected')),
  created_by    uuid not null references public.profiles(id),
  approved_by   uuid references public.profiles(id),
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- WORK INSTRUCTION STEPS
-- ----------------------------------------------------------------
create table public.wi_steps (
  id                   uuid primary key default gen_random_uuid(),
  work_instruction_id  uuid not null references public.work_instructions(id) on delete cascade,
  step_template_id     uuid references public.step_templates(id),
  step_order           integer not null,
  name                 text not null,
  description          text,
  parameters           jsonb not null default '{}',
  -- parameters examples:
  --   gather_inputs: { "inputs": [{ "material_id": "uuid", "material_name": "NaOH", "quantity": 40, "unit": "g" }] }
  --   weigh: { "material_id": "uuid", "material_name": "NaOH", "target_weight": 40.0, "unit": "g", "tolerance_pct": 2.0 }
  --   mix: { "duration_minutes": 10, "duration_options": [5, 10, 30] }
  --   heat: { "target_temp_c": 80, "duration_minutes": 15 }
  created_at           timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- APPROVAL HISTORY
-- ----------------------------------------------------------------
create table public.wi_approvals (
  id                   uuid primary key default gen_random_uuid(),
  work_instruction_id  uuid not null references public.work_instructions(id) on delete cascade,
  reviewer_id          uuid not null references public.profiles(id),
  action               text not null
                         check (action in ('submitted','approved','rejected','revision_requested')),
  comment              text,
  created_at           timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- PRODUCTION ORDERS
-- ----------------------------------------------------------------
create table public.production_orders (
  id                   uuid primary key default gen_random_uuid(),
  work_instruction_id  uuid not null references public.work_instructions(id),
  lot_number           text not null,
  batch_size           numeric,
  batch_size_unit      text default 'L',
  status               text not null default 'pending'
                         check (status in ('pending','in_progress','completed','failed','cancelled')),
  notes                text,
  created_by           uuid not null references public.profiles(id),
  assigned_to          uuid references public.profiles(id),
  started_at           timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- PRODUCTION ORDER STEPS (execution log per step)
-- ----------------------------------------------------------------
create table public.po_steps (
  id                  uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  wi_step_id          uuid not null references public.wi_steps(id),
  step_order          integer not null,
  status              text not null default 'pending'
                        check (status in ('pending','in_progress','completed','skipped')),
  actual_values       jsonb not null default '{}',
  -- actual_values examples:
  --   weigh:   { "measured_weight": 40.1, "unit": "g", "in_tolerance": true, "deviation_pct": 0.25 }
  --   mix:     { "actual_duration_minutes": 10, "completed": true }
  --   observe: { "observation": "Solution turned clear after 3 min" }
  notes               text,
  operator_id         uuid references public.profiles(id),
  started_at          timestamptz,
  completed_at        timestamptz,
  created_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------
create index on public.wi_steps (work_instruction_id, step_order);
create index on public.po_steps (production_order_id, step_order);
create index on public.production_orders (work_instruction_id);
create index on public.wi_approvals (work_instruction_id);

-- ----------------------------------------------------------------
-- UPDATED_AT trigger for work_instructions
-- ----------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_work_instructions_updated_at
  before update on public.work_instructions
  for each row execute procedure public.set_updated_at();

-- ----------------------------------------------------------------
-- SEED: built-in system step templates
-- ----------------------------------------------------------------
insert into public.step_templates (name, description, step_type, parameter_schema, is_system)
values
  ('Gather Inputs',
   'Collect and verify all required materials/reagents before beginning.',
   'gather_inputs',
   '{
     "inputs": {
       "type": "array",
       "label": "Inputs",
       "items": {
         "material_id": { "type": "string", "label": "Material" },
         "material_name": { "type": "string", "label": "Material Name" },
         "quantity": { "type": "number", "label": "Quantity" },
         "unit": { "type": "string", "label": "Unit", "options": ["g","kg","mg","mL","L","mol"] }
       }
     }
   }',
   true),

  ('Weigh',
   'Weigh out a precise amount of a material and verify it is within tolerance.',
   'weigh',
   '{
     "material_id": { "type": "string", "label": "Material" },
     "material_name": { "type": "string", "label": "Material Name" },
     "target_weight": { "type": "number", "label": "Target Weight" },
     "unit": { "type": "string", "label": "Unit", "options": ["g","kg","mg"] },
     "tolerance_pct": { "type": "number", "label": "Tolerance (%)", "default": 2.0 }
   }',
   true),

  ('Mix',
   'Mix the solution for a specified duration.',
   'mix',
   '{
     "duration_minutes": { "type": "number", "label": "Duration (min)", "options": [5, 10, 15, 20, 30, 45, 60] },
     "speed": { "type": "string", "label": "Mix Speed", "options": ["low","medium","high"], "required": false }
   }',
   true),

  ('Transfer',
   'Transfer solution from one vessel to another.',
   'transfer',
   '{
     "from_vessel": { "type": "string", "label": "From Vessel" },
     "to_vessel": { "type": "string", "label": "To Vessel" },
     "volume_mL": { "type": "number", "label": "Volume (mL)", "required": false }
   }',
   true),

  ('Heat',
   'Heat the solution to the specified temperature for a specified duration.',
   'heat',
   '{
     "target_temp_c": { "type": "number", "label": "Target Temp (°C)" },
     "duration_minutes": { "type": "number", "label": "Duration (min)" }
   }',
   true),

  ('Cool',
   'Cool the solution to the specified temperature.',
   'cool',
   '{
     "target_temp_c": { "type": "number", "label": "Target Temp (°C)" },
     "method": { "type": "string", "label": "Method", "options": ["ambient","ice_bath","freezer"], "required": false }
   }',
   true),

  ('Adjust pH',
   'Add acid or base dropwise to reach the target pH.',
   'ph_adjust',
   '{
     "target_ph": { "type": "number", "label": "Target pH" },
     "tolerance": { "type": "number", "label": "Tolerance (±pH units)", "default": 0.1 },
     "reagent": { "type": "string", "label": "Adjusting Reagent" }
   }',
   true),

  ('Observe & Record',
   'Record an observation (color, clarity, odor, etc.) about the solution.',
   'observe',
   '{
     "prompt": { "type": "string", "label": "Observation Prompt" }
   }',
   true),

  ('Custom Step',
   'A freeform step for any operation not covered by a standard template.',
   'custom',
   '{
     "instruction_text": { "type": "string", "label": "Instruction Text" }
   }',
   true);
