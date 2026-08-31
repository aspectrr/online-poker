-- ASPTR-180: public.users profile table keyed to Supabase auth.users.
create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- Writes come from the Go server (service role) only; authenticated users can read.
alter table public.users enable row level security;

drop policy if exists "users read" on public.users;
create policy "users read"
  on public.users for select
  to authenticated
  using (true);
-- No insert/update/delete policies: only the service role (RLS-exempt) writes.
