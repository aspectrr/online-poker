-- ASPTR-179: game_tables + hands. Config/hand payloads are jsonb; schema lives in Go (TableConfig).
create table if not exists public.game_tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  game_type text not null,
  config jsonb not null,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.hands (
  id bigserial primary key,
  table_id uuid references public.game_tables (id) on delete cascade,
  hand_no int not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_hands_table_hand on public.hands (table_id, hand_no);

-- Read-mostly: authenticated users read; writes come from the Go server (service role, RLS-exempt).
alter table public.game_tables enable row level security;
drop policy if exists "game_tables read" on public.game_tables;
create policy "game_tables read"
  on public.game_tables for select
  to authenticated
  using (true);

alter table public.hands enable row level security;
drop policy if exists "hands read" on public.hands;
create policy "hands read"
  on public.hands for select
  to authenticated
  using (true);
-- No insert/update/delete policies: only the service role writes.

-- Grants: hosted Supabase covers these via default privileges, local `db start` does not.
grant select on public.game_tables, public.hands to authenticated;
grant usage, select on sequence public.hands_id_seq to authenticated;
grant select, insert, update, delete on public.game_tables, public.hands to service_role;
