-- Genesis — Supabase schema
-- Run this once in your Supabase project's SQL editor (Project > SQL Editor > New query).
-- Safe to re-run: uses "if not exists" / "or replace" throughout.

-- Profiles: mirrors auth.users with the display name, so it's easy to
-- query/join from SQL without touching Supabase's internal auth schema.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are viewable by owner" on public.profiles;
create policy "profiles are viewable by owner"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles are editable by owner" on public.profiles;
create policy "profiles are editable by owner"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "profiles are insertable by owner" on public.profiles;
create policy "profiles are insertable by owner"
  on public.profiles for insert
  with check (auth.uid() = id);


-- Lets a signed-in user delete their OWN account (and everything cascades
-- via the "on delete cascade" foreign keys above — recordings, environments,
-- usage_events, profile all go with it). security definer so it can reach
-- auth.users, which a plain RLS policy can't touch — but it's hard-locked to
-- auth.uid() internally, so it can never be used to delete anyone else.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_own_account() to authenticated;


-- Recordings metadata. The actual video file lives in Supabase Storage
-- (bucket "recordings"); this table just indexes it per user.
create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  title text,
  environment text,
  quality text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.recordings enable row level security;

drop policy if exists "recordings are owner-only" on public.recordings;
create policy "recordings are owner-only"
  on public.recordings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- Storage buckets for recordings/environments. Private (not public) — access
-- only via signed URLs generated for the owning user, enforced below by
-- storage.objects policies that check the first path segment is their uid.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('environments', 'environments', false)
on conflict (id) do nothing;

drop policy if exists "recordings storage is owner-only" on storage.objects;
create policy "recordings storage is owner-only"
  on storage.objects for all
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "environments storage is owner-only" on storage.objects;
create policy "environments storage is owner-only"
  on storage.objects for all
  using (bucket_id = 'environments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'environments' and (storage.foldername(name))[1] = auth.uid()::text);


-- Custom environment uploads metadata (file itself in Storage bucket "environments").
create table if not exists public.environments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

alter table public.environments enable row level security;

drop policy if exists "environments are owner-only" on public.environments;
create policy "environments are owner-only"
  on public.environments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- Usage accounting — per your original spec's Section 18. Not wired into
-- the app yet (nothing costs money yet — see docs/MODEL_PROVIDER.md), but
-- the table exists so it's ready the moment a paid provider is added.
create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,       -- e.g. 'gpu_seconds', 'storage_bytes', 'stream_minutes'
  quantity numeric not null,
  cost_usd numeric,
  created_at timestamptz not null default now()
);

alter table public.usage_events enable row level security;

drop policy if exists "usage is owner-only" on public.usage_events;
create policy "usage is owner-only"
  on public.usage_events for select
  using (auth.uid() = user_id);
