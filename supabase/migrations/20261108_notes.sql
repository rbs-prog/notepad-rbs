create table public.notes (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  title text not null default 'Nota sem título',
  custom boolean not null default false,
  updated bigint not null,
  deleted boolean not null default false,
  data jsonb not null default '{}'::jsonb,
  primary key (user_id, id)
);
alter table public.notes enable row level security;
create policy notes_owner_select on public.notes for select to authenticated using (user_id = (select auth.uid()));
create policy notes_owner_insert on public.notes for insert to authenticated with check (user_id = (select auth.uid()));
create policy notes_owner_update on public.notes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notes_owner_delete on public.notes for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.notes from anon;
grant select, insert, update, delete on public.notes to authenticated;
