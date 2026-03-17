-- Run this in Supabase SQL editor for the web-only prototype.
-- Flow: query student_schedule, then insert into attendance_log.

create extension if not exists pgcrypto;

create table if not exists public.student_schedule (
  id uuid primary key default gen_random_uuid(),
  student_email text not null,
  service_uuid text not null,
  classroom_label text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists student_schedule_lookup_idx
  on public.student_schedule (student_email, service_uuid, starts_at, ends_at);

create unique index if not exists student_schedule_unique_slot_idx
  on public.student_schedule (student_email, service_uuid, starts_at, ends_at);

create table if not exists public.attendance_log (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.student_schedule(id) on delete set null,
  student_email text not null,
  student_name text,
  service_uuid text not null,
  classroom_label text,
  teacher_device_id text,
  teacher_device_name text,
  checked_in_at timestamptz not null default now(),
  source text not null default 'github-pages-web-bluetooth',
  created_at timestamptz not null default now()
);

create index if not exists attendance_log_student_email_idx
  on public.attendance_log (student_email, checked_in_at desc);

create index if not exists attendance_log_schedule_id_idx
  on public.attendance_log (schedule_id);

alter table public.student_schedule enable row level security;
alter table public.attendance_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'student_schedule'
      and policyname = 'allow_select_schedule_from_anon'
  ) then
    create policy allow_select_schedule_from_anon
      on public.student_schedule
      for select
      to anon
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'attendance_log'
      and policyname = 'allow_insert_attendance_from_anon'
  ) then
    create policy allow_insert_attendance_from_anon
      on public.attendance_log
      for insert
      to anon
      with check (true);
  end if;
end
$$;

-- Example seed row for quick testing. Adjust times for your timezone/class period.
insert into public.student_schedule (student_email, service_uuid, classroom_label, starts_at, ends_at)
values (
  'student@school.edu',
  '0000181c-0000-1000-8000-00805f9b34fb',
  'Room 101 - Period 3',
  now() - interval '10 minutes',
  now() + interval '40 minutes'
)
on conflict do nothing;
