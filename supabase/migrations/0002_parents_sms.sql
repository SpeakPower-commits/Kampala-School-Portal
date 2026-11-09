-- =============================================================================
-- 0002_parents_sms.sql — the parent portal and SMS.
--
-- Parents sign in with an SMS code sent to a guardian number the school holds.
-- They read only their own children's fees, published results, attendance and
-- the notices meant for parents, through parent_portal(); they get no access to
-- the tables themselves.
--
-- Each school sends SMS through its own Africa's Talking account. The account
-- key is encrypted by the Cloudflare Worker before it is stored here and is
-- never readable through the API. Who may send what, to whom, and with what
-- text is decided in this file, never by the browser. Only the Worker (with the
-- Supabase secret key) takes batches to send and records the results.
--
-- Apply after 0001_init.sql: Dashboard → SQL Editor → paste → Run.
-- =============================================================================

-- ── A second guardian per learner ────────────────────────────────────────────
-- Either guardian can sign in to the parent portal and receive SMS. The
-- learners_guard trigger in 0001 already protects this column from bursars
-- and coaches, because it compares whole rows.
alter table public.learners add column guardian2_phone text not null default '';

-- ── Phone numbers in one form ────────────────────────────────────────────────
-- Digits with the country code: '0772 123 456', '772123456' and
-- '+256 772 123 456' all become '256772123456'. Other countries' numbers given
-- with their code are kept; anything else becomes ''.
create or replace function public.msisdn(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when d ~ '^0[0-9]{9}$' then '256' || substr(d, 2)
    when d ~ '^[1-9][0-9]{8}$' then '256' || d
    when d ~ '^[1-9][0-9]{10,14}$' then d
    else '' end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;
create index learners_guardian_idx  on public.learners (public.msisdn(guardian_phone))  where deleted_at is null;
create index learners_guardian2_idx on public.learners (public.msisdn(guardian2_phone)) where deleted_at is null;

-- The signed-in parent's number, but only once Supabase has verified it with an
-- SMS code. Read from auth.users rather than trusted from the token.
create or replace function public.parent_phone() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select public.msisdn(u.phone) from auth.users u
                    where u.id = auth.uid() and u.phone is not null and u.phone_confirmed_at is not null), '')
$$;

-- ── Notices for parents ──────────────────────────────────────────────────────
alter table public.notices add column audience text not null default 'staff' check (audience in ('staff', 'all'));

-- ── Published results ────────────────────────────────────────────────────────
-- A parent's view holds only their own child, so class positions cannot be
-- worked out there. They are frozen when the school publishes a term's results,
-- exactly as on the printed report cards.
create table public.term_results (
  school_id       uuid not null references public.schools(id) on delete cascade,
  learner_id      text not null,
  term_id         text not null,
  position        integer,
  out_of          integer,
  stream_position integer,
  stream_out_of   integer,
  average         numeric(5,1),
  result          text not null default '',
  published_at    timestamptz not null default now(),
  primary key (school_id, learner_id, term_id),
  foreign key (school_id, term_id) references public.terms(school_id, id) on delete cascade
);

create or replace function public.publish_results(p_school uuid, p_term text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.has_role(p_school, array['exec','admin']) then
    raise exception 'Only the Executive Director or the Administrator can publish results.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.terms t where t.school_id = p_school and t.id = p_term) then
    raise exception 'That term does not exist.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 10000 then
    raise exception 'Results must be a list of at most 10,000 learners.' using errcode = '22023';
  end if;
  delete from public.term_results where school_id = p_school and term_id = p_term;
  insert into public.term_results (school_id, learner_id, term_id, position, out_of, stream_position, stream_out_of, average, result)
  select p_school, r ->> 'learner_id', p_term, (r ->> 'position')::integer, (r ->> 'out_of')::integer,
         (r ->> 'stream_position')::integer, (r ->> 'stream_out_of')::integer, (r ->> 'average')::numeric, left(coalesce(r ->> 'result', ''), 80)
    from jsonb_array_elements(p_rows) r
   where exists (select 1 from public.learners l where l.school_id = p_school and l.id = r ->> 'learner_id');
  get diagnostics n = row_count;
  update public.terms set results_published = true where school_id = p_school and id = p_term;
  perform public.log_audit(p_school, 'RESULTS_PUBLISH', p_term || ': ' || n || ' learners');
  return n;
end $$;

create or replace function public.unpublish_results(p_school uuid, p_term text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_school, array['exec','admin']) then
    raise exception 'Only the Executive Director or the Administrator can withdraw results.' using errcode = '42501';
  end if;
  delete from public.term_results where school_id = p_school and term_id = p_term;
  update public.terms set results_published = false where school_id = p_school and id = p_term;
  perform public.log_audit(p_school, 'RESULTS_WITHDRAW', p_term);
end $$;

-- ── SMS through each school's own Africa's Talking account ──────────────────
create table public.school_sms (
  school_id   uuid primary key references public.schools(id) on delete cascade,
  at_username text not null check (length(trim(at_username)) between 1 and 60),
  sender_id   text not null default '' check (length(sender_id) <= 11),
  sandbox     boolean not null default false,
  key_cipher  text not null,                 -- encrypted by the Worker; never readable through the API
  key_hint    text not null default '',      -- the key's last characters, to recognise it
  updated_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create table public.sms_campaigns (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete cascade,
  kind            text not null check (kind in ('fees','absence','broadcast')),
  options         jsonb not null default '{}'::jsonb,
  status          text not null default 'draft' check (status in ('draft','sending','done','cancelled')),
  recipients      integer not null default 0,
  parts           integer not null default 0,
  sent            integer not null default 0,
  failed          integer not null default 0,
  created_by      uuid references auth.users(id) on delete set null,
  created_by_name text not null default '',
  created_at      timestamptz not null default now(),
  finished_at     timestamptz
);
create index sms_campaigns_school_idx on public.sms_campaigns (school_id, created_at desc);

create table public.sms_messages (
  id            bigint generated always as identity primary key,
  campaign_id   uuid not null references public.sms_campaigns(id) on delete cascade,
  school_id     uuid not null references public.schools(id) on delete cascade,
  learner_id    text not null default '',   -- '' for a message to every guardian
  to_msisdn     text not null check (to_msisdn ~ '^[1-9][0-9]{10,14}$'),
  body          text not null,
  parts         integer not null default 1,
  status        text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  at_message_id text,
  cost          text,
  error         text,
  created_at    timestamptz not null default now(),
  taken_at      timestamptz,
  sent_at       timestamptz,
  unique (campaign_id, learner_id, to_msisdn)
);
create index sms_messages_campaign_idx on public.sms_messages (campaign_id, status);

-- SMS pages a text needs: 160 characters (153 each when split) in the plain
-- GSM alphabet, 70 (67) once it holds anything else.
create or replace function public.sms_parts(p text) returns integer
language sql immutable set search_path = '' as $$
  select case
    when coalesce(p, '') ~ '^[ -~\n\r]*$'
      then case when length(coalesce(p, '')) <= 160 then 1 else ceil(length(p) / 153.0)::integer end
    else case when length(p) <= 70 then 1 else ceil(length(p) / 67.0)::integer end
  end
$$;

-- May the caller manage this school's SMS account ('settings') or see its
-- balance ('balance')? Returns the caller's id when they may, for the Worker.
create or replace function public.sms_can(p_school uuid, p_action text) returns uuid
language sql stable security definer set search_path = '' as $$
  select case
    when p_action = 'settings' and public.has_role(p_school, array['exec']) then auth.uid()
    when p_action = 'balance'  and public.has_role(p_school, array['exec','admin','bursary','teacher']) then auth.uid()
  end
$$;

-- May the caller send this campaign? Its creator (while still a member) and the
-- school's exec or admin may. Returns the school when they may.
create or replace function public.sms_can_send(p_campaign uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.school_id from public.sms_campaigns c
   where c.id = p_campaign and c.status in ('draft','sending')
     and ((c.created_by = auth.uid() and public.is_member(c.school_id)) or public.has_role(c.school_id, array['exec','admin']))
$$;

-- Prepare a campaign. Recipients and the text of every message are worked out
-- here from the school's own records. Returns a preview; nothing is sent yet.
-- The wording is kept short and in the plain SMS alphabet (a hyphen, not a
-- dash) so a typical message is one SMS page, not two.
--   fees       learners who owe (bills minus valid payments)    exec, admin, bursary
--   absence    learners marked absent in a class's register      exec, admin, the class's teacher
--   broadcast  every guardian (or a class's)                     exec, admin
-- options: { class?, date? (absence), message? (broadcast), both? (also the second guardian) }
create or replace function public.sms_create_campaign(p_school uuid, p_kind text, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role    text := public.my_role(p_school);
  v_opts    jsonb := coalesce(p_options, '{}'::jsonb);
  v_both    boolean := coalesce((v_opts ->> 'both')::boolean, false);
  v_class   text := nullif(trim(coalesce(v_opts ->> 'class', '')), '');
  v_date    date;
  v_text    text;
  v_school  text;
  v_cur     text;
  v_targets jsonb;
  v_id      uuid;
  v_count   integer;
  v_parts   integer;
  v_sample  text;
  v_skipped integer;
begin
  if v_role is null then
    raise exception 'You are not a member of this school.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.school_sms z where z.school_id = p_school) then
    raise exception 'SMS is not set up for this school yet. The Executive Director adds the school''s Africa''s Talking account under Administration → SMS.' using errcode = 'P0002';
  end if;
  select coalesce(nullif(s.settings ->> 'schoolName', ''), s.name), coalesce(nullif(s.settings ->> 'currency', ''), 'UGX')
    into v_school, v_cur from public.schools s where s.id = p_school;

  if p_kind = 'fees' then
    if v_role not in ('exec','admin','bursary') then
      raise exception 'Only the Executive Director, the Administrator or the Bursary Officer can send fee reminders.' using errcode = '42501';
    end if;
    select jsonb_agg(t) into v_targets from (
      select l.id, l.guardian_phone as g1, l.guardian2_phone as g2,
             'Dear parent, the school fees balance for ' || l.name || ' (' || l.class || ') is '
               || v_cur || ' ' || to_char(b.bal, 'FM999,999,999,990') || '. Kindly clear it soon. - ' || v_school as body
        from public.learners l
        cross join lateral (
          select coalesce((select sum(i.total) from public.invoices i where i.school_id = l.school_id and i.learner_id = l.id), 0)
               - coalesce((select sum(p.amount) from public.payments p where p.school_id = l.school_id and p.learner_id = l.id and not p.void), 0) as bal
        ) b
       where l.school_id = p_school and l.deleted_at is null and b.bal > 0 and (v_class is null or l.class = v_class)
       order by l.class, l.name
    ) t;
  elsif p_kind = 'absence' then
    v_date := nullif(v_opts ->> 'date', '')::date;
    if v_class is null or v_date is null then
      raise exception 'Choose the class and the date of the register.' using errcode = '22023';
    end if;
    if v_role not in ('exec','admin','teacher') or not public.can_see_class(p_school, v_class) then
      raise exception 'You can only send absence messages for your own classes.' using errcode = '42501';
    end if;
    select jsonb_agg(t) into v_targets from (
      select distinct on (l.id) l.id, l.guardian_phone as g1, l.guardian2_phone as g2,
             'Dear parent, ' || l.name || ' (' || l.class || ') was absent from school on ' || to_char(v_date, 'YYYY-MM-DD')
               || '. Please contact the school if you were not aware. - ' || v_school as body
        from public.registers r
        cross join lateral jsonb_array_elements(r.records) rec
        join public.learners l on l.school_id = r.school_id and l.id = rec ->> 'studentId'
       where r.school_id = p_school and r.class = v_class and r.reg_date = v_date
         and rec ->> 'status' = 'A' and l.deleted_at is null
       order by l.id
    ) t;
  elsif p_kind = 'broadcast' then
    if v_role not in ('exec','admin') then
      raise exception 'Only the Executive Director or the Administrator can message every guardian.' using errcode = '42501';
    end if;
    v_text := trim(coalesce(v_opts ->> 'message', ''));
    if length(v_text) < 3 or length(v_text) > 400 then
      raise exception 'The message must be between 3 and 400 characters.' using errcode = '22023';
    end if;
    select jsonb_agg(t) into v_targets from (
      select '' as id, l.guardian_phone as g1, l.guardian2_phone as g2, v_text || ' - ' || v_school as body
        from public.learners l
       where l.school_id = p_school and l.deleted_at is null and (v_class is null or l.class = v_class)
    ) t;
  else
    raise exception 'Unknown kind of message.' using errcode = '22023';
  end if;
  v_targets := coalesce(v_targets, '[]'::jsonb);
  if jsonb_array_length(v_targets) > 5000 then
    raise exception 'That is more than 5,000 learners at once. Send it class by class.' using errcode = '22023';
  end if;

  insert into public.sms_campaigns (school_id, kind, options, created_by, created_by_name)
  values (p_school, p_kind, v_opts, auth.uid(),
          coalesce((select m.display_name from public.memberships m where m.school_id = p_school and m.user_id = auth.uid()), ''))
  returning id into v_id;

  -- One message per learner to the first valid number (the second if the
  -- first is unusable), plus the second guardian when asked. A number gets a
  -- given learner's message once; a message to every guardian goes once per number.
  insert into public.sms_messages (campaign_id, school_id, learner_id, to_msisdn, body, parts)
  select v_id, p_school, y.id, v.n, y.body, public.sms_parts(y.body)
    from (select t ->> 'id' as id, t ->> 'body' as body,
                 public.msisdn(t ->> 'g1') as n1, public.msisdn(t ->> 'g2') as n2
            from jsonb_array_elements(v_targets) t) y
    cross join lateral (values (case when y.n1 <> '' then y.n1 else y.n2 end),
                               (case when v_both and y.n1 <> '' and y.n2 <> '' and y.n2 <> y.n1 then y.n2 else '' end)) v(n)
   where v.n <> ''
  on conflict do nothing;

  select count(*) filter (where public.msisdn(t ->> 'g1') = '' and public.msisdn(t ->> 'g2') = '')
    into v_skipped from jsonb_array_elements(v_targets) t;
  select count(*), coalesce(sum(m.parts), 0) into v_count, v_parts from public.sms_messages m where m.campaign_id = v_id;
  select m.body into v_sample from public.sms_messages m where m.campaign_id = v_id order by m.id limit 1;
  update public.sms_campaigns
     set recipients = v_count, parts = v_parts,
         status = case when v_count = 0 then 'done' else status end,
         finished_at = case when v_count = 0 then now() end
   where id = v_id;
  return jsonb_build_object('campaign_id', v_id, 'recipients', v_count, 'parts', v_parts, 'sample', v_sample, 'skipped', v_skipped);
end $$;

-- Stop a run. A preview that was never sent is removed with its messages, so
-- the log shows only what went out; a run that had started stays, as stopped.
create or replace function public.sms_cancel_campaign(p_campaign uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select c.status into v_status from public.sms_campaigns c
   where c.id = p_campaign and c.status in ('draft','sending')
     and ((c.created_by = auth.uid() and public.is_member(c.school_id)) or public.has_role(c.school_id, array['exec','admin']))
   for update;
  if not found then raise exception 'That message run cannot be stopped.' using errcode = 'P0002'; end if;
  if v_status = 'draft' then
    delete from public.sms_campaigns where id = p_campaign;   -- messages go with it (on delete cascade)
  else
    update public.sms_campaigns set status = 'cancelled', finished_at = now() where id = p_campaign;
  end if;
end $$;

create or replace function public.sms_remove_settings(p_school uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_school, array['exec']) then
    raise exception 'Only the Executive Director can change the SMS account.' using errcode = '42501';
  end if;
  delete from public.school_sms where school_id = p_school;
  perform public.log_audit(p_school, 'SMS_SETTINGS', 'Africa''s Talking account removed');
end $$;

-- ── For the Worker only (Supabase secret key) ────────────────────────────────
-- Store the school's account. The Worker has checked the key with Africa's
-- Talking and encrypted it; p_user is the director it verified (re-checked here).
create or replace function public.sms_store_settings(p_school uuid, p_user uuid, p_username text, p_sender text,
                                                     p_sandbox boolean, p_cipher text, p_hint text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.memberships m
                  where m.school_id = p_school and m.user_id = p_user and m.role = 'exec' and m.active) then
    raise exception 'Only the Executive Director can set up SMS.' using errcode = '42501';
  end if;
  insert into public.school_sms (school_id, at_username, sender_id, sandbox, key_cipher, key_hint, updated_by, updated_at)
  values (p_school, trim(p_username), trim(coalesce(p_sender, '')), coalesce(p_sandbox, false), p_cipher, left(coalesce(p_hint, ''), 8), p_user, now())
  on conflict (school_id) do update
    set at_username = excluded.at_username, sender_id = excluded.sender_id, sandbox = excluded.sandbox,
        key_cipher = excluded.key_cipher, key_hint = excluded.key_hint, updated_by = excluded.updated_by, updated_at = now();
  insert into public.audit_log (school_id, user_id, username, action, detail)
  select p_school, p_user, m.display_name, 'SMS_SETTINGS',
         left('Africa''s Talking account ' || trim(p_username) || ' saved (key ending ' || left(coalesce(p_hint, ''), 8) || ')', 200)
    from public.memberships m where m.school_id = p_school and m.user_id = p_user;
end $$;

create or replace function public.sms_settings_for(p_school uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('username', z.at_username, 'sender_id', z.sender_id, 'sandbox', z.sandbox, 'key_cipher', z.key_cipher,
                            'school_name', coalesce(nullif(s.settings ->> 'schoolName', ''), s.name))
    from public.school_sms z join public.schools s on s.id = z.school_id
   where z.school_id = p_school
$$;

-- Take up to 40 queued messages to send. A message left half-sent by a run that
-- died is marked failed, never sent again, so nobody is texted twice.
create or replace function public.sms_take_batch(p_campaign uuid, p_limit integer default 40) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_school uuid; v_set jsonb; v_msgs jsonb; v_left integer;
begin
  update public.sms_messages
     set status = 'failed', error = 'Interrupted before Africa''s Talking answered; not sent again, to avoid a duplicate.'
   where campaign_id = p_campaign and status = 'sending' and taken_at < now() - interval '10 minutes';
  update public.sms_campaigns set status = 'sending' where id = p_campaign and status in ('draft','sending')
  returning school_id into v_school;
  if v_school is null then
    return jsonb_build_object('messages', '[]'::jsonb, 'remaining', 0, 'stopped', true);
  end if;
  v_set := public.sms_settings_for(v_school);
  if v_set is null then raise exception 'SMS is not set up for this school.' using errcode = 'P0002'; end if;
  with picked as (
    select m.id from public.sms_messages m
     where m.campaign_id = p_campaign and m.status = 'queued'
     order by m.id limit greatest(1, least(coalesce(p_limit, 40), 40))
     for update skip locked
  ), taken as (
    update public.sms_messages m set status = 'sending', taken_at = now()
      from picked where m.id = picked.id
    returning m.id, m.to_msisdn, m.body
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'to', to_msisdn, 'body', body) order by id), '[]'::jsonb) into v_msgs from taken;
  select count(*) into v_left from public.sms_messages where campaign_id = p_campaign and status = 'queued';
  return jsonb_build_object('school_id', v_school, 'settings', v_set, 'messages', v_msgs, 'remaining', v_left);
end $$;

-- Record what Africa's Talking said about each message in a batch:
-- [{ id, ok, message_id?, cost?, error? }]. Finishes the campaign when nothing is left.
create or replace function public.sms_record_results(p_campaign uuid, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_before text; v_out jsonb; c record;
begin
  select status into v_before from public.sms_campaigns where id = p_campaign;
  update public.sms_messages m
     set status = case when (r ->> 'ok')::boolean then 'sent' else 'failed' end,
         at_message_id = nullif(left(r ->> 'message_id', 80), ''),
         cost = nullif(left(r ->> 'cost', 40), ''),
         error = nullif(left(r ->> 'error', 200), ''),
         sent_at = case when (r ->> 'ok')::boolean then now() end
    from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
   where m.campaign_id = p_campaign and m.id = (r ->> 'id')::bigint and m.status = 'sending';
  update public.sms_campaigns s
     set sent = x.sent, failed = x.failed,
         status = case when x.open = 0 and s.status = 'sending' then 'done' else s.status end,
         finished_at = case when x.open = 0 and s.finished_at is null then now() else s.finished_at end
    from (select count(*) filter (where status = 'sent') as sent, count(*) filter (where status = 'failed') as failed,
                 count(*) filter (where status in ('queued','sending')) as open
            from public.sms_messages where campaign_id = p_campaign) x
   where s.id = p_campaign
  returning s.* into c;
  if c.status = 'done' and v_before is distinct from 'done' then
    insert into public.audit_log (school_id, user_id, username, action, detail)
    values (c.school_id, c.created_by, c.created_by_name, 'SMS_SENT', c.kind || ': ' || c.sent || ' sent, ' || c.failed || ' failed');
  end if;
  v_out := jsonb_build_object('sent', c.sent, 'failed', c.failed, 'status', c.status,
             'remaining', (select count(*) from public.sms_messages where campaign_id = p_campaign and status = 'queued'));
  return v_out;
end $$;

-- For the sign-in code: is this number a guardian at a school that has SMS set
-- up? If so, which school's account sends the code.
create or replace function public.sms_hook_lookup(p_phone text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('school_id', s.id, 'school_name', coalesce(nullif(s.settings ->> 'schoolName', ''), s.name),
                            'settings', jsonb_build_object('username', z.at_username, 'sender_id', z.sender_id,
                                                           'sandbox', z.sandbox, 'key_cipher', z.key_cipher))
    from public.learners l
    join public.schools s on s.id = l.school_id
    join public.school_sms z on z.school_id = l.school_id
   where l.deleted_at is null and public.msisdn(p_phone) <> ''
     and (public.msisdn(l.guardian_phone) = public.msisdn(p_phone) or public.msisdn(l.guardian2_phone) = public.msisdn(p_phone))
   order by s.created_at
   limit 1
$$;

-- ── The parent portal ────────────────────────────────────────────────────────
-- Everything a guardian may see about their children at one school, in the
-- row shapes the app already reads (sync.js stateFromRows). Results, comments,
-- positions and conduct only for published terms; register entries cut down to
-- the child's own record; only the notices meant for parents.
create or replace function public.parent_school(p_school uuid, p_phone text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with kids as (
    select l.* from public.learners l
     where l.school_id = p_school and l.deleted_at is null and p_phone <> ''
       and (public.msisdn(l.guardian_phone) = p_phone or public.msisdn(l.guardian2_phone) = p_phone)
  ),
  pub as (select t.* from public.terms t where t.school_id = p_school and t.results_published),
  cur as (select t.* from public.terms t where t.school_id = p_school order by t.is_active desc, t.year desc, t.term desc limit 1)
  select jsonb_build_object(
    'school', (select jsonb_build_object('id', s.id, 'name', s.name, 'settings', s.settings) from public.schools s where s.id = p_school),
    'terms', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'year', t.year, 'term', t.term, 'start_date', t.start_date,
                         'end_date', t.end_date, 'is_active', t.is_active, 'opened_at', t.opened_at,
                         'results_published', t.results_published) order by t.year, t.term)
                         from public.terms t where t.school_id = p_school), '[]'::jsonb),
    'learners', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'class', k.class, 'stream', k.stream,
                         'level', k.level, 'combination', k.combination, 'gender', k.gender, 'boarding', k.boarding,
                         'guardian_phone', k.guardian_phone, 'guardian2_phone', k.guardian2_phone, 'fee', k.fee,
                         'bursary_pct', k.bursary_pct, 'uneb_index', k.uneb_index, 'sen', '', 'sport', k.sport, 'skill', k.skill,
                         'extra', '{}'::jsonb, 'created_at', k.created_at) order by k.name) from kids k), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(to_jsonb(i) - 'school_id' - 'created_at' - 'updated_at')
                         from public.invoices i where i.school_id = p_school and i.learner_id in (select id from kids)), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'learner_id', p.learner_id, 'amount', p.amount, 'method', p.method,
                         'reference', p.reference, 'paid_on', p.paid_on, 'recorded_by_name', p.recorded_by_name, 'ts', p.ts, 'void', false))
                         from public.payments p where p.school_id = p_school and not p.void and p.learner_id in (select id from kids)), '[]'::jsonb),
    'fee_structures', coalesce((select jsonb_agg(to_jsonb(f) - 'school_id' - 'created_at' - 'updated_at')
                         from public.fee_structures f where f.school_id = p_school and not f.draft
                          and (f.applies_to = 'All' or f.applies_to in (select class from kids) or f.applies_to in (select level from kids))), '[]'::jsonb),
    'marks', coalesce((select jsonb_agg(to_jsonb(m) - 'school_id' - 'created_at' - 'updated_at')
                         from public.marks m where m.school_id = p_school and m.learner_id in (select id from kids)
                          and m.term_id in (select id from pub)), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(to_jsonb(c) - 'school_id' - 'created_at' - 'updated_at')
                         from public.comments c where c.school_id = p_school and c.learner_id in (select id from kids)
                          and c.term_id in (select id from pub)), '[]'::jsonb),
    'term_results', coalesce((select jsonb_agg(to_jsonb(r) - 'school_id')
                         from public.term_results r where r.school_id = p_school and r.learner_id in (select id from kids)
                          and r.term_id in (select id from pub)), '[]'::jsonb),
    'conduct', coalesce((select jsonb_agg(to_jsonb(c) - 'school_id' - 'created_at' - 'updated_at')
                         from public.conduct c where c.school_id = p_school and c.learner_id in (select id from kids)
                          and exists (select 1 from pub t where (t.start_date is null or c.occurred_on >= t.start_date)
                                                           and (t.end_date is null or c.occurred_on <= t.end_date))), '[]'::jsonb),
    'registers', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'class', r.class, 'stream', r.stream, 'reg_date', r.reg_date,
                         'marked_by', '', 'records', mine.recs) order by r.reg_date)
                         from public.registers r
                         cross join cur
                         cross join lateral (select jsonb_agg(x) as recs from jsonb_array_elements(r.records) x
                                              where x ->> 'studentId' in (select id from kids)) mine
                        where r.school_id = p_school and r.class in (select class from kids) and mine.recs is not null
                          and r.reg_date >= coalesce(cur.start_date, current_date - 120)
                          and (cur.end_date is null or r.reg_date <= cur.end_date)), '[]'::jsonb),
    'notices', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'category', n.category,
                         'posted_by', n.posted_by, 'posted_at', n.posted_at) order by n.posted_at desc)
                         from (select * from public.notices n where n.school_id = p_school and n.audience = 'all'
                                order by n.posted_at desc limit 30) n), '[]'::jsonb)
  )
$$;

create or replace function public.parent_portal() returns jsonb
language sql stable security definer set search_path = '' as $$
  with me as (select public.parent_phone() as phone),
  mine as (
    select distinct l.school_id from public.learners l, me
     where me.phone <> '' and l.deleted_at is null
       and (public.msisdn(l.guardian_phone) = me.phone or public.msisdn(l.guardian2_phone) = me.phone)
  )
  select jsonb_build_object('phone', (select phone from me),
           'schools', coalesce((select jsonb_agg(public.parent_school(m.school_id, (select phone from me))) from mine m), '[]'::jsonb))
$$;

-- ── Row-level security ───────────────────────────────────────────────────────
alter table public.term_results  enable row level security;
alter table public.school_sms    enable row level security;
alter table public.sms_campaigns enable row level security;
alter table public.sms_messages  enable row level security;

create policy term_results_read on public.term_results for select to authenticated using (public.is_member(school_id));
create policy school_sms_read on public.school_sms for select to authenticated using (public.has_role(school_id, array['exec','admin']));
create policy sms_campaigns_read on public.sms_campaigns for select to authenticated
  using (public.has_role(school_id, array['exec','admin']) or (created_by = auth.uid() and public.is_member(school_id)));
create policy sms_messages_read on public.sms_messages for select to authenticated using (public.has_role(school_id, array['exec','admin']));

-- ── Privileges ───────────────────────────────────────────────────────────────
-- Reading only; every change goes through the functions above. The account
-- key's ciphertext is not readable by anyone through the API.
revoke all on public.term_results, public.school_sms, public.sms_campaigns, public.sms_messages from anon, authenticated;
grant select on public.term_results, public.sms_campaigns, public.sms_messages to authenticated;
grant select (school_id, at_username, sender_id, sandbox, key_hint, updated_at) on public.school_sms to authenticated;

-- Supabase lets every role run new functions by default; take that back.
revoke execute on function
  public.msisdn(text), public.parent_phone(), public.publish_results(uuid, text, jsonb), public.unpublish_results(uuid, text),
  public.sms_parts(text), public.sms_can(uuid, text), public.sms_can_send(uuid), public.sms_create_campaign(uuid, text, jsonb),
  public.sms_cancel_campaign(uuid), public.sms_remove_settings(uuid),
  public.sms_store_settings(uuid, uuid, text, text, boolean, text, text), public.sms_settings_for(uuid),
  public.sms_take_batch(uuid, integer), public.sms_record_results(uuid, jsonb), public.sms_hook_lookup(text),
  public.parent_school(uuid, text), public.parent_portal()
  from public, anon, authenticated;
grant execute on function
  public.msisdn(text), public.sms_parts(text), public.publish_results(uuid, text, jsonb), public.unpublish_results(uuid, text),
  public.sms_can(uuid, text), public.sms_can_send(uuid), public.sms_create_campaign(uuid, text, jsonb),
  public.sms_cancel_campaign(uuid), public.sms_remove_settings(uuid), public.parent_portal()
  to authenticated;
grant execute on function
  public.sms_store_settings(uuid, uuid, text, text, boolean, text, text), public.sms_settings_for(uuid),
  public.sms_take_batch(uuid, integer), public.sms_record_results(uuid, jsonb), public.sms_hook_lookup(text)
  to service_role;
