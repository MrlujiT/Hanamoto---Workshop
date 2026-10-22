-- Hanamoto Workshop: database, security rules and file storage.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text,
  role text not null check (role in ('directors','jeff','walter','client','screen1','screen2','screen3')),
  title text not null default '',
  boss uuid,
  jobs text[] not null default '{}',
  is_owner boolean not null default false,
  must_change boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists docs_job_idx on public.docs (collection, (data->>'job'));

alter table public.profiles enable row level security;
alter table public.docs enable row level security;

-- Who is asking? (the owner counts as a director)
create or replace function public.me_role() returns text
language sql stable security definer set search_path = public as $$
  select case when is_owner then 'directors' else role end from profiles where id = auth.uid()
$$;
create or replace function public.me_jobs() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(jobs, '{}') from profiles where id = auth.uid()
$$;

-- profiles: staff see everyone, everyone sees themselves. Changes go through the server functions only.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.me_role() in ('directors','jeff','walter','screen1','screen2','screen3'));

-- docs: read
drop policy if exists docs_select on public.docs;
create policy docs_select on public.docs for select to authenticated using (
  public.me_role() in ('directors','jeff','walter','screen1','screen2','screen3')
  or (collection = 'jobs' and id = any(public.me_jobs()))
  or (collection in ('items','batches','files') and data->>'job' = any(public.me_jobs()))
);

-- docs: create
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated with check (
  (collection in ('jobs','items','rules') and public.me_role() in ('directors','jeff'))
  or (collection in ('batches','crew') and public.me_role() in ('directors','jeff','walter'))
  or (collection = 'files' and (public.me_role() in ('directors','jeff','walter') or data->>'job' = any(public.me_jobs())))
);

-- docs: change
drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated using (
  (collection in ('items','crew') and public.me_role() in ('directors','jeff','walter'))
  or (collection in ('jobs','rules') and public.me_role() in ('directors','jeff'))
  or (collection = 'jobs' and id = any(public.me_jobs()))
  or (collection = 'batches' and (public.me_role() in ('directors','jeff','walter') or data->>'job' = any(public.me_jobs())))
) with check (
  (collection in ('items','crew') and public.me_role() in ('directors','jeff','walter'))
  or (collection in ('jobs','rules') and public.me_role() in ('directors','jeff'))
  or (collection = 'jobs' and id = any(public.me_jobs()))
  or (collection = 'batches' and (public.me_role() in ('directors','jeff','walter') or data->>'job' = any(public.me_jobs())))
);

-- docs: remove
drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated using (
  public.me_role() = 'directors'
  or (collection = 'crew' and public.me_role() in ('jeff','walter'))
  or (collection in ('files','rules') and public.me_role() = 'jeff')
);

-- merge-update used by the app
create or replace function public.doc_update(p_collection text, p_id text, p_patch jsonb) returns void
language plpgsql security invoker as $$
begin
  update docs set data = data || p_patch, version = version + 1, updated_at = now()
   where collection = p_collection and id = p_id;
  if not found then
    raise exception 'Not allowed, or the record no longer exists';
  end if;
end $$;

create or replace function public.clear_must_change() returns void
language sql security definer set search_path = public as $$
  update profiles set must_change = false where id = auth.uid()
$$;

-- live updates
alter publication supabase_realtime add table public.docs;
alter publication supabase_realtime add table public.profiles;

-- file storage (drawings, quotations, photos)
insert into storage.buckets (id, name, public) values ('files', 'files', true) on conflict (id) do nothing;
drop policy if exists files_read on storage.objects;
create policy files_read on storage.objects for select using (bucket_id = 'files');
drop policy if exists files_write on storage.objects;
create policy files_write on storage.objects for insert to authenticated with check (bucket_id = 'files');

-- ===== 22 Oct 2026: stock categories, vehicles, express jobs, procurement documents =====
-- Additive changes only. Every existing rule is kept exactly as it was.

-- READ
alter policy docs_select on public.docs using (
  (me_role() = any (array['directors','jeff','walter','screen1','screen2','screen3']))
  or ((me_role() = any (array['procurement','storekeeper'])) and (collection = any (array['jobs','settings','stock','moves','matreq','po','crew','cats'])))
  or ((me_role() = 'procurement') and collection = 'files' and (data ->> 'by') = 'procurement')
  or ((me_role() = 'crew') and (collection = any (array['jobs','items','crew','batches','settings'])))
  or ((collection = 'jobs') and (id = any (me_jobs())))
  or ((collection = any (array['items','batches','files'])) and ((data ->> 'job') = any (me_jobs()))
      and not (collection = 'files' and coalesce(data ->> 'internal','false') = 'true'))
);

-- CREATE
alter policy docs_insert on public.docs with check (
  ((collection = any (array['jobs','items','rules'])) and (me_role() = any (array['directors','jeff'])))
  or ((collection = any (array['batches','crew'])) and (me_role() = any (array['directors','jeff','walter'])))
  or ((collection = 'files') and ((me_role() = any (array['directors','jeff','walter'])) or ((data ->> 'job') = any (me_jobs()))))
  or ((collection = 'files') and me_role() = 'procurement')
  or ((collection = any (array['stock','moves'])) and (me_role() = any (array['directors','storekeeper','procurement'])))
  or ((collection = 'matreq') and (me_role() = any (array['directors','jeff','walter'])))
  or ((collection = 'po') and (me_role() = any (array['directors','jeff','storekeeper','procurement'])))
  or ((collection = 'settings') and (me_role() = 'directors'))
  or ((collection = 'cats') and (me_role() = any (array['directors','storekeeper','procurement'])))
  or ((collection = 'vehicles') and (me_role() = any (array['directors','jeff'])))
);

-- CHANGE (same list for USING and WITH CHECK)
alter policy docs_update on public.docs using (
  ((collection = 'items') and (me_role() = any (array['directors','jeff','walter','crew'])))
  or ((collection = 'crew') and (me_role() = any (array['directors','jeff','walter'])))
  or ((collection = 'jobs') and (me_role() = any (array['directors','jeff','procurement'])))
  or ((collection = 'rules') and (me_role() = any (array['directors','jeff'])))
  or ((collection = 'jobs') and (id = any (me_jobs())))
  or ((collection = 'batches') and ((me_role() = any (array['directors','jeff','walter'])) or ((data ->> 'job') = any (me_jobs()))))
  or ((collection = 'stock') and (me_role() = any (array['directors','storekeeper','procurement'])))
  or ((collection = 'matreq') and (me_role() = any (array['directors','jeff','walter','storekeeper'])))
  or ((collection = 'po') and (me_role() = any (array['directors','jeff','storekeeper','procurement'])))
  or ((collection = 'settings') and (me_role() = 'directors'))
  or ((collection = 'vehicles') and (me_role() = any (array['directors','jeff'])))
);
alter policy docs_update on public.docs with check (
  ((collection = 'items') and (me_role() = any (array['directors','jeff','walter','crew'])))
  or ((collection = 'crew') and (me_role() = any (array['directors','jeff','walter'])))
  or ((collection = 'jobs') and (me_role() = any (array['directors','jeff','procurement'])))
  or ((collection = 'rules') and (me_role() = any (array['directors','jeff'])))
  or ((collection = 'jobs') and (id = any (me_jobs())))
  or ((collection = 'batches') and ((me_role() = any (array['directors','jeff','walter'])) or ((data ->> 'job') = any (me_jobs()))))
  or ((collection = 'stock') and (me_role() = any (array['directors','storekeeper','procurement'])))
  or ((collection = 'matreq') and (me_role() = any (array['directors','jeff','walter','storekeeper'])))
  or ((collection = 'po') and (me_role() = any (array['directors','jeff','storekeeper','procurement'])))
  or ((collection = 'settings') and (me_role() = 'directors'))
  or ((collection = 'vehicles') and (me_role() = any (array['directors','jeff'])))
);

-- REMOVE
alter policy docs_delete on public.docs using (
  (me_role() = 'directors')
  or ((collection = 'crew') and (me_role() = any (array['jeff','walter'])))
  or ((collection = any (array['files','rules'])) and (me_role() = 'jeff'))
  or ((collection = 'files') and me_role() = 'procurement' and (data ->> 'by') = 'procurement')
  or ((collection = 'cats') and (me_role() = any (array['storekeeper','procurement'])))
  or ((collection = 'vehicles') and (me_role() = 'jeff'))
);

-- ===== 22 Oct 2026 (b): help messages. These policies replace the 22 Oct (a) ones above =====
-- Additive changes only. Every existing rule is kept exactly as it was.

-- READ
alter policy docs_select on public.docs using (
  ((me_role() = any (array['directors','jeff','walter','screen1','screen2','screen3'])) and collection <> 'tickets')
  or ((me_role() = any (array['procurement','storekeeper'])) and (collection = any (array['jobs','settings','stock','moves','matreq','po','crew','cats'])))
  or ((me_role() = 'procurement') and collection = 'files' and (data ->> 'by') = 'procurement')
  or ((me_role() = 'crew') and (collection = any (array['jobs','items','crew','batches','settings'])))
  or ((collection = 'jobs') and (id = any (me_jobs())))
  or ((collection = any (array['items','batches','files'])) and ((data ->> 'job') = any (me_jobs()))
      and not (collection = 'files' and coalesce(data ->> 'internal','false') = 'true'))
  or ((collection = 'tickets') and (me_role() = 'directors' or (data ->> 'by') = auth.uid()::text))
);

-- CREATE
alter policy docs_insert on public.docs with check (
  ((collection = any (array['jobs','items','rules'])) and (me_role() = any (array['directors','jeff'])))
  or ((collection = any (array['batches','crew'])) and (me_role() = any (array['directors','jeff','walter'])))
  or ((collection = 'files') and ((me_role() = any (array['directors','jeff','walter'])) or ((data ->> 'job') = any (me_jobs()))))
  or ((collection = 'files') and me_role() = 'procurement')
  or ((collection = any (array['stock','moves'])) and (me_role() = any (array['directors','storekeeper','procurement'])))
  or ((collection = 'matreq') and (me_role() = any (array['directors','jeff','walter'])))
  or ((collection = 'po') and (me_role() = any (array['directors','jeff','storekeeper','procurement'])))
  or ((collection = 'settings') and (me_role() = 'directors'))
  or ((collection = 'cats') and (me_role() = any (array['directors','storekeeper','procurement'])))
  or ((collection = 'vehicles') and (me_role() = any (array['directors','jeff'])))
  or ((collection = 'tickets') and me_role() is not null and (data ->> 'by') = auth.uid()::text)
);

-- CHANGE (same list for USING and WITH CHECK)
alter policy docs_update on public.docs using (
  ((collection = 'items') and (me_role() = any (array['directors','jeff','walter','crew'])))
  or ((collection = 'crew') and (me_role() = any (array['directors','jeff','walter'])))
  or ((collection = 'jobs') and (me_role() = any (array['directors','jeff','procurement'])))
  or ((collection = 'rules') and (me_role() = any (array['directors','jeff'])))
  or ((collection = 'jobs') and (id = any (me_jobs())))
  or ((collection = 'batches') and ((me_role() = any (array['directors','jeff','walter'])) or ((data ->> 'job') = any (me_jobs()))))
  or ((collection = 'stock') and (me_role() = any (array['directors','storekeeper','procurement'])))
  or ((collection = 'matreq') and (me_role() = any (array['directors','jeff','walter','storekeeper'])))
  or ((collection = 'po') and (me_role() = any (array['directors','jeff','storekeeper','procurement'])))
  or ((collection = 'settings') and (me_role() = 'directors'))
  or ((collection = 'vehicles') and (me_role() = any (array['directors','jeff'])))
  or ((collection = 'tickets') and (me_role() = 'directors' or (data ->> 'by') = auth.uid()::text))
);
alter policy docs_update on public.docs with check (
  ((collection = 'items') and (me_role() = any (array['directors','jeff','walter','crew'])))
  or ((collection = 'crew') and (me_role() = any (array['directors','jeff','walter'])))
  or ((collection = 'jobs') and (me_role() = any (array['directors','jeff','procurement'])))
  or ((collection = 'rules') and (me_role() = any (array['directors','jeff'])))
  or ((collection = 'jobs') and (id = any (me_jobs())))
  or ((collection = 'batches') and ((me_role() = any (array['directors','jeff','walter'])) or ((data ->> 'job') = any (me_jobs()))))
  or ((collection = 'stock') and (me_role() = any (array['directors','storekeeper','procurement'])))
  or ((collection = 'matreq') and (me_role() = any (array['directors','jeff','walter','storekeeper'])))
  or ((collection = 'po') and (me_role() = any (array['directors','jeff','storekeeper','procurement'])))
  or ((collection = 'settings') and (me_role() = 'directors'))
  or ((collection = 'vehicles') and (me_role() = any (array['directors','jeff'])))
  or ((collection = 'tickets') and (me_role() = 'directors' or (data ->> 'by') = auth.uid()::text))
);

-- REMOVE
alter policy docs_delete on public.docs using (
  (me_role() = 'directors')
  or ((collection = 'crew') and (me_role() = any (array['jeff','walter'])))
  or ((collection = any (array['files','rules'])) and (me_role() = 'jeff'))
  or ((collection = 'files') and me_role() = 'procurement' and (data ->> 'by') = 'procurement')
  or ((collection = 'cats') and (me_role() = any (array['storekeeper','procurement'])))
  or ((collection = 'vehicles') and (me_role() = 'jeff'))
);
