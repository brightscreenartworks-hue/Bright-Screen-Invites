-- =====================================================================
-- Bright Screen Invites — Admin Panel database schema (Supabase / Postgres)
-- Safe to run more than once: every statement is idempotent and NOTHING
-- here drops or truncates existing data.
-- Run in: Supabase Dashboard → SQL Editor → New query → paste → Run.
-- Admin emails are NOT stored in this file: add them with
--   scripts/setup-admins.mjs  (reads ADMIN_EMAILS from your environment)
-- or run, once, in the SQL editor:
--   insert into public.admin_allowlist (email) values ('first@gmail.com'), ('second@gmail.com');
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Admin allowlist (only these emails can ever reach admin data)
-- ---------------------------------------------------------------------
create table if not exists public.admin_allowlist (
  email       text primary key check (email = lower(email) and position('@' in email) > 1),
  added_by    text,
  created_at  timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_allowlist
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.current_admin_email()
returns text language sql stable as $$
  select coalesce(lower(auth.jwt() ->> 'email'), 'system');
$$;

-- ---------------------------------------------------------------------
-- 2. Settings (non-secret configuration; secrets live in Vercel env vars)
-- ---------------------------------------------------------------------
create table if not exists public.settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

insert into public.settings (key, value) values
  ('whatsapp', jsonb_build_object(
      'enabled', true,
      'provider', 'callmebot',
      'destination', '918745028722',
      'include_admin_link', true)),
  ('general', jsonb_build_object(
      'max_admins', 3,
      'idle_timeout_minutes', 120))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 3. Categories (top level + subcategories via parent_id)
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id                    uuid primary key default gen_random_uuid(),
  parent_id             uuid references public.categories(id) on delete restrict,
  slug                  text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name                  text not null check (char_length(name) between 1 and 120),
  description           text check (char_length(description) <= 600),
  page_title            text,
  page_description      text,
  badge                 text check (char_length(badge) <= 80),
  icon                  text check (char_length(icon) <= 16),
  page_url              text,          -- top level: existing page (e.g. video-invites.html); null = collection.html?c=slug
  hash                  text,          -- subcategory route hash, e.g. caricature-wedding-invites
  view_id               text,          -- DOM id of the subcategory panel
  card_id               text,          -- DOM id of the subcategory card
  custom_thumbnail_url  text,          -- null = use the first sample's thumbnail automatically
  sort_order            integer not null default 0,
  is_visible            boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists categories_top_slug_uq on public.categories (slug) where parent_id is null;
create unique index if not exists categories_sub_slug_uq on public.categories (parent_id, slug) where parent_id is not null;
create index if not exists categories_parent_idx on public.categories (parent_id, sort_order);

-- Only two levels: a subcategory's parent must itself be top level.
create or replace function public.categories_guard()
returns trigger language plpgsql as $$
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'A category cannot be its own parent';
    end if;
    if exists (select 1 from public.categories where id = new.parent_id and parent_id is not null) then
      raise exception 'Subcategories can only be created under a top-level category';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.categories where parent_id = new.id) then
      raise exception 'This category has subcategories, so it must stay top level';
    end if;
    new.hash    := coalesce(nullif(new.hash, ''), new.slug);
    new.view_id := coalesce(nullif(new.view_id, ''), 'view-' || new.slug);
    new.card_id := coalesce(nullif(new.card_id, ''), 'card-cat-' || new.slug);
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists categories_guard_trg on public.categories;
create trigger categories_guard_trg before insert or update on public.categories
  for each row execute function public.categories_guard();

-- ---------------------------------------------------------------------
-- 4. Samples
-- ---------------------------------------------------------------------
create table if not exists public.samples (
  id                    uuid primary key default gen_random_uuid(),
  legacy_id             text unique,                 -- DOM id of cards that existed before the admin panel
  category_id           uuid not null references public.categories(id) on delete restrict,
  subcategory_id        uuid references public.categories(id) on delete restrict,
  title                 text not null check (char_length(title) between 1 and 200),
  description           text check (char_length(description) <= 2000),
  media_url             text check (char_length(media_url) <= 2000),
  media_provider        text not null default 'other'
                          check (media_provider in ('youtube','instagram','vimeo','google_photos','google_drive','facebook','pinterest','website','image','other')),
  share_url             text check (char_length(share_url) <= 2000),
  auto_thumbnail_url    text check (char_length(auto_thumbnail_url) <= 2000),
  custom_thumbnail_url  text check (char_length(custom_thumbnail_url) <= 2000),
  thumbnail_fallbacks   text[] not null default '{}',
  alt_text              text check (char_length(alt_text) <= 300),
  vertical_thumb        boolean not null default false,  -- adds the existing "yt-shorts-thumb" crop class
  fill_label            text,                            -- name passed to fill-details.html (defaults to title)
  fill_category         text,                            -- category passed to fill-details.html (defaults to category name)
  link_title            text,
  tag_title             text,
  status                text not null default 'published' check (status in ('published','hidden','draft')),
  sort_order            integer not null default 0,
  uploaded_at           timestamptz not null default now(),
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists samples_cat_idx on public.samples (category_id, subcategory_id, sort_order);
create index if not exists samples_status_idx on public.samples (status);

create or replace function public.samples_guard()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.categories where id = new.category_id and parent_id is not null) then
    raise exception 'category_id must be a top-level category';
  end if;
  if new.subcategory_id is not null and not exists (
      select 1 from public.categories where id = new.subcategory_id and parent_id = new.category_id) then
    raise exception 'Subcategory does not belong to the selected category';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, public.current_admin_email());
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists samples_guard_trg on public.samples;
create trigger samples_guard_trg before insert or update on public.samples
  for each row execute function public.samples_guard();

-- ---------------------------------------------------------------------
-- 5. Client submissions (permanent — never auto-deleted)
-- ---------------------------------------------------------------------
create table if not exists public.submissions (
  id                 uuid primary key default gen_random_uuid(),
  ref                text unique not null default (
                        'BS-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' ||
                        upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6))),
  idempotency_key    text unique not null,
  source             text not null default 'fill-details',
  status             text not null default 'new' check (status in ('new','in_progress','completed','archived')),
  category           text,
  sample_name        text,
  sample_link        text,
  client_name        text,
  client_whatsapp    text,
  client_email       text,
  payload            jsonb not null default '{}'::jsonb,
  summary_text       text,
  whatsapp_status    text not null default 'pending' check (whatsapp_status in ('pending','sent','failed','disabled')),
  whatsapp_error     text,
  whatsapp_attempts  integer not null default 0,
  whatsapp_sent_at   timestamptz,
  ip_hash            text,
  user_agent         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists submissions_created_idx on public.submissions (created_at desc);
create index if not exists submissions_status_idx on public.submissions (status);
create index if not exists submissions_ip_idx on public.submissions (ip_hash, created_at);

create table if not exists public.submission_notes (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  body           text not null check (char_length(body) between 1 and 4000),
  author         text not null default public.current_admin_email(),
  created_at     timestamptz not null default now()
);
create index if not exists submission_notes_sub_idx on public.submission_notes (submission_id, created_at);

create table if not exists public.submission_events (
  id             bigint generated always as identity primary key,
  submission_id  uuid not null references public.submissions(id) on delete cascade,
  type           text not null,          -- created | status | note | whatsapp | restored
  detail         jsonb not null default '{}'::jsonb,
  actor          text not null default public.current_admin_email(),
  created_at     timestamptz not null default now()
);
create index if not exists submission_events_sub_idx on public.submission_events (submission_id, created_at);

-- Recovery bin: a manual delete keeps a full copy here so it can be restored.
create table if not exists public.submissions_trash (
  id           uuid primary key,
  data         jsonb not null,
  notes        jsonb not null default '[]'::jsonb,
  events       jsonb not null default '[]'::jsonb,
  deleted_by   text,
  deleted_at   timestamptz not null default now()
);

create or replace function public.submissions_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists submissions_touch_trg on public.submissions;
create trigger submissions_touch_trg before update on public.submissions
  for each row execute function public.submissions_touch();

create or replace function public.submissions_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into submission_events (submission_id, type, detail, actor)
      values (new.id, 'created', jsonb_build_object('source', new.source), 'client');
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into submission_events (submission_id, type, detail)
        values (new.id, 'status', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.whatsapp_attempts is distinct from old.whatsapp_attempts then
      insert into submission_events (submission_id, type, detail, actor)
        values (new.id, 'whatsapp', jsonb_build_object('status', new.whatsapp_status, 'error', new.whatsapp_error),
                case when auth.jwt() ->> 'email' is null then 'system' else public.current_admin_email() end);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists submissions_history_trg on public.submissions;
create trigger submissions_history_trg after insert or update on public.submissions
  for each row execute function public.submissions_history();

create or replace function public.submission_note_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into submission_events (submission_id, type, detail, actor)
    values (new.submission_id, 'note', jsonb_build_object('note_id', new.id, 'preview', left(new.body, 120)), new.author);
  return new;
end $$;
drop trigger if exists submission_note_event_trg on public.submission_notes;
create trigger submission_note_event_trg after insert on public.submission_notes
  for each row execute function public.submission_note_event();

create or replace function public.submissions_to_trash()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into submissions_trash (id, data, notes, events, deleted_by)
  values (
    old.id,
    to_jsonb(old),
    coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at) from submission_notes n where n.submission_id = old.id), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from submission_events e where e.submission_id = old.id), '[]'::jsonb),
    public.current_admin_email())
  on conflict (id) do update set data = excluded.data, notes = excluded.notes, events = excluded.events,
    deleted_by = excluded.deleted_by, deleted_at = now();
  return old;
end $$;
drop trigger if exists submissions_to_trash_trg on public.submissions;
create trigger submissions_to_trash_trg before delete on public.submissions
  for each row execute function public.submissions_to_trash();

-- Restore a deleted submission (with its notes and history) from the recovery bin.
create or replace function public.restore_submission(p_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare t submissions_trash;
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  select * into t from submissions_trash where id = p_id;
  if not found then raise exception 'Nothing to restore'; end if;
  if exists (select 1 from submissions where id = p_id) then raise exception 'Submission already exists'; end if;
  perform set_config('bs.silent', 'on', true);
  insert into submissions select * from jsonb_populate_record(null::submissions, t.data);
  insert into submission_notes select * from jsonb_populate_recordset(null::submission_notes, t.notes);
  -- the inserts above re-created "created"/"note" events; replace them with the original history
  delete from submission_events where submission_id = p_id;
  insert into submission_events (submission_id, type, detail, actor, created_at)
    select submission_id, type, detail, actor, created_at
    from jsonb_populate_recordset(null::submission_events, t.events);
  insert into submission_events (submission_id, type, detail)
    values (p_id, 'restored', jsonb_build_object('deleted_at', t.deleted_at, 'deleted_by', t.deleted_by));
  delete from submissions_trash where id = p_id;
  return p_id;
end $$;

-- ---------------------------------------------------------------------
-- 6. Activity log (dashboard "Recent Activity")
-- ---------------------------------------------------------------------
create table if not exists public.activity_log (
  id         bigint generated always as identity primary key,
  actor      text not null,
  action     text not null,
  entity     text not null,      -- sample | category | submission | admin | settings
  entity_id  text,
  summary    text,
  created_at timestamptz not null default now()
);
create index if not exists activity_log_created_idx on public.activity_log (created_at desc);

create or replace function public.log_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor  text := case when auth.jwt() ->> 'email' is null then 'system' else public.current_admin_email() end;
  v_entity text := tg_argv[0];
  v_action text := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  v_label  text;
  v_id     text;
  v_new    jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old    jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_rec    jsonb := coalesce(v_new, v_old);
begin
  if current_setting('bs.silent', true) = 'on' then return null; end if;
  if v_entity = 'sample' then
    v_label := v_rec ->> 'title'; v_id := v_rec ->> 'id';
    if tg_op = 'UPDATE' then
      if v_new ->> 'status' is distinct from v_old ->> 'status' then
        v_action := case v_new ->> 'status' when 'published' then 'published' when 'hidden' then 'hid' else 'moved to draft' end;
      elsif (v_new - 'sort_order' - 'updated_at') = (v_old - 'sort_order' - 'updated_at') then
        return null;  -- pure reorders are logged once by reorder()
      end if;
    end if;
  elsif v_entity = 'category' then
    v_label := v_rec ->> 'name'; v_id := v_rec ->> 'id';
    if tg_op = 'UPDATE' and (v_new - 'sort_order' - 'updated_at') = (v_old - 'sort_order' - 'updated_at') then
      return null;
    end if;
  elsif v_entity = 'submission' then
    v_id := v_rec ->> 'id';
    v_label := coalesce(v_rec ->> 'ref', '') || ' · ' || coalesce(nullif(v_rec ->> 'client_name', ''), 'Client');
    if tg_op = 'INSERT' then v_actor := 'client'; v_action := 'received';
    elsif tg_op = 'UPDATE' then
      if v_new ->> 'status' is distinct from v_old ->> 'status' then
        v_action := 'marked ' || replace(v_new ->> 'status', '_', ' ');
      else return null; end if;
    end if;
  elsif v_entity = 'admin' then
    v_label := v_rec ->> 'email'; v_id := v_rec ->> 'email';
    v_action := case tg_op when 'INSERT' then 'granted access' else 'revoked access' end;
  elsif v_entity = 'settings' then
    v_label := v_rec ->> 'key'; v_id := v_rec ->> 'key';
  end if;
  insert into activity_log (actor, action, entity, entity_id, summary)
    values (v_actor, v_action, v_entity, v_id, v_label);
  return null;
end $$;

drop trigger if exists samples_activity_trg on public.samples;
create trigger samples_activity_trg after insert or update or delete on public.samples
  for each row execute function public.log_activity('sample');
drop trigger if exists categories_activity_trg on public.categories;
create trigger categories_activity_trg after insert or update or delete on public.categories
  for each row execute function public.log_activity('category');
drop trigger if exists submissions_activity_trg on public.submissions;
create trigger submissions_activity_trg after insert or update or delete on public.submissions
  for each row execute function public.log_activity('submission');
drop trigger if exists allowlist_activity_trg on public.admin_allowlist;
create trigger allowlist_activity_trg after insert or delete on public.admin_allowlist
  for each row execute function public.log_activity('admin');
drop trigger if exists settings_activity_trg on public.settings;
create trigger settings_activity_trg after update on public.settings
  for each row execute function public.log_activity('settings');

-- ---------------------------------------------------------------------
-- 7. Allowlist guards: cap on admins, never remove the last one / yourself
-- ---------------------------------------------------------------------
create or replace function public.allowlist_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_max int;
begin
  if tg_op = 'INSERT' then
    select (value ->> 'max_admins')::int into v_max from settings where key = 'general';
    v_max := coalesce(v_max, 3);
    if (select count(*) from admin_allowlist) >= v_max then
      raise exception 'Admin limit reached (% accounts). Remove one first or raise the limit in Settings.', v_max;
    end if;
    new.email := lower(trim(new.email));
    new.added_by := coalesce(new.added_by, public.current_admin_email());
    return new;
  else
    if (select count(*) from admin_allowlist) <= 1 then
      raise exception 'You cannot remove the last admin';
    end if;
    if old.email = public.current_admin_email() then
      raise exception 'You cannot remove your own access';
    end if;
    return old;
  end if;
end $$;
drop trigger if exists allowlist_guard_trg on public.admin_allowlist;
create trigger allowlist_guard_trg before insert or delete on public.admin_allowlist
  for each row execute function public.allowlist_guard();

-- Block public registration at the database level: an auth account can only
-- be created for an allowlisted email (in addition to disabling sign-ups).
create or replace function public.block_non_admin_signup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.admin_allowlist where email = lower(new.email)) then
    raise exception 'Registration is disabled';
  end if;
  return new;
end $$;
drop trigger if exists block_non_admin_signup_trg on auth.users;
create trigger block_non_admin_signup_trg before insert on auth.users
  for each row execute function public.block_non_admin_signup();

-- Atomic reorder helper (one call, one activity entry)
create or replace function public.reorder(p_table text, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Not authorized'; end if;
  if p_table = 'samples' then
    update samples s set sort_order = x.ord - 1
      from unnest(p_ids) with ordinality as x(id, ord) where s.id = x.id;
    insert into activity_log (actor, action, entity, summary)
      values (public.current_admin_email(), 'reordered', 'sample', array_length(p_ids, 1) || ' samples');
  elsif p_table = 'categories' then
    update categories c set sort_order = x.ord - 1
      from unnest(p_ids) with ordinality as x(id, ord) where c.id = x.id;
    insert into activity_log (actor, action, entity, summary)
      values (public.current_admin_email(), 'reordered', 'category', array_length(p_ids, 1) || ' categories');
  else
    raise exception 'Unknown table';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Row Level Security — every table is closed by default; only
--    allowlisted admins (checked in the database via is_admin()) get access.
--    The public website reads through /api/catalog (server-side, published
--    items only) and writes through /api/submit (server-side).
-- ---------------------------------------------------------------------
alter table public.admin_allowlist   enable row level security;
alter table public.settings          enable row level security;
alter table public.categories        enable row level security;
alter table public.samples           enable row level security;
alter table public.submissions       enable row level security;
alter table public.submission_notes  enable row level security;
alter table public.submission_events enable row level security;
alter table public.submissions_trash enable row level security;
alter table public.activity_log      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['settings','categories','samples','submissions','submission_notes'] loop
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
  foreach t in array array['admin_allowlist','submission_events','submissions_trash','activity_log'] loop
    execute format('drop policy if exists admin_read on public.%I', t);
    execute format('create policy admin_read on public.%I for select to authenticated using (public.is_admin())', t);
  end loop;
end $$;

drop policy if exists admin_insert on public.admin_allowlist;
create policy admin_insert on public.admin_allowlist for insert to authenticated with check (public.is_admin());
drop policy if exists admin_delete on public.admin_allowlist;
create policy admin_delete on public.admin_allowlist for delete to authenticated using (public.is_admin());
drop policy if exists admin_purge on public.submissions_trash;
create policy admin_purge on public.submissions_trash for delete to authenticated using (public.is_admin());

revoke all on all tables in schema public from anon;
revoke execute on function public.restore_submission(uuid) from anon, public;
revoke execute on function public.reorder(text, uuid[]) from anon, public;
grant execute on function public.restore_submission(uuid) to authenticated;
grant execute on function public.reorder(text, uuid[]) to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------
-- 9. Storage bucket for custom thumbnails (public read, admin write)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sample-thumbnails', 'sample-thumbnails', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif','image/avif'])
on conflict (id) do nothing;

drop policy if exists "thumbs admin insert" on storage.objects;
create policy "thumbs admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'sample-thumbnails' and public.is_admin());
drop policy if exists "thumbs admin update" on storage.objects;
create policy "thumbs admin update" on storage.objects for update to authenticated
  using (bucket_id = 'sample-thumbnails' and public.is_admin());
drop policy if exists "thumbs admin delete" on storage.objects;
create policy "thumbs admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'sample-thumbnails' and public.is_admin());
