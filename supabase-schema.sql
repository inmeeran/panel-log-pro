-- Panel Log Pro — minimal secure cloud schema
-- Run this once in Supabase Dashboard → SQL Editor.
-- This stores the existing application's data model as JSONB so the current UI
-- can move to the cloud without a destructive rewrite. A normalized schema can
-- be introduced later without changing the user-facing app.

create table if not exists public.panel_log_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.panel_log_data enable row level security;

drop policy if exists "Users can read their own Panel Log data" on public.panel_log_data;
create policy "Users can read their own Panel Log data"
on public.panel_log_data for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert their own Panel Log data" on public.panel_log_data;
create policy "Users can insert their own Panel Log data"
on public.panel_log_data for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update their own Panel Log data" on public.panel_log_data;
create policy "Users can update their own Panel Log data"
on public.panel_log_data for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create index if not exists panel_log_data_updated_at_idx
on public.panel_log_data(updated_at desc);
