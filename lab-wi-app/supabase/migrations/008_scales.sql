-- ============================================================
-- Migration 008: Lab Scales
-- Stores scale hardware info and two independent API connection
-- configs so operators can use a primary or fallback endpoint.
-- ============================================================

do $$ begin
  create type public.scale_connection_type as enum (
    'http_rest', 'websocket', 'modbus_tcp', 'opc_ua'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.scale_status as enum (
    'active', 'inactive', 'maintenance'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.scales (
  id                  uuid primary key default gen_random_uuid(),

  -- Identity
  name                text not null,
  model               text,
  manufacturer        text,
  serial_number       text,
  location            text,
  notes               text,
  status              public.scale_status not null default 'active',

  -- Connection A (primary)
  conn_a_type         public.scale_connection_type not null,
  conn_a_label        text not null default 'Primary',
  -- jsonb config shape depends on conn type:
  --   http_rest  : { url, auth_token?, polling_interval_ms? }
  --   websocket  : { url, auth_token? }
  --   modbus_tcp : { host, port, unit_id?, register_address? }
  --   opc_ua     : { endpoint_url, node_id, username?, password? }
  conn_a_config       jsonb not null default '{}'::jsonb,

  -- Connection B (secondary / fallback) — optional
  conn_b_type         public.scale_connection_type,
  conn_b_label        text not null default 'Secondary',
  conn_b_config       jsonb not null default '{}'::jsonb,

  -- Which connection is preferred (1 = A, 2 = B)
  preferred_conn      smallint not null default 1 check (preferred_conn in (1, 2)),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Auto-update updated_at
create or replace function public.touch_scales_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$ begin
  create trigger scales_updated_at
    before update on public.scales
    for each row execute procedure public.touch_scales_updated_at();
exception when duplicate_object then null;
end $$;

-- ── RLS ─────────────────────────────────────────────────────
alter table public.scales enable row level security;

-- All authenticated users can view scales (needed for WI/production context later)
do $$ begin
  create policy "scales_read" on public.scales
    for select to authenticated using (true);
exception when duplicate_object then null;
end $$;

-- Only admins can insert / update / delete
do $$ begin
  create policy "scales_admin_write" on public.scales
    for all to authenticated
    using  (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'))
    with check (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
exception when duplicate_object then null;
end $$;
