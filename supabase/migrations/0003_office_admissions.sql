-- 0003: the school office admits learners.
--
-- In a Ugandan school a child is admitted by the office: the director, the
-- administrator or the bursar (admission and the first fees go together).
-- Teachers never admit learners. Until now only the director and the
-- administrator could add a learner, and the bursar could change nothing on a
-- learner but the bursary percentage.
--
-- After this migration the bursar can:
--   • add (admit) a learner;
--   • correct a learner's details (name, class, guardian numbers…).
-- The bursar still cannot remove a learner (deleted_at), and the administrator
-- still cannot change a bursary.

drop policy if exists learners_insert on public.learners;
create policy learners_insert on public.learners for insert to authenticated
  with check (public.has_role(school_id, array['exec','admin','bursary']));

create or replace function public.learners_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r text := public.my_role(new.school_id);
begin
  if r = 'bursary' and new.deleted_at is distinct from old.deleted_at then
    raise exception 'Only the Executive Director or the Administrator can remove a learner.' using errcode = '42501';
  end if;
  if r = 'coach' and (to_jsonb(new) - 'sport' - 'skill' - 'extra' - 'updated_at') <> (to_jsonb(old) - 'sport' - 'skill' - 'extra' - 'updated_at') then
    raise exception 'Coaches can only change sport details.' using errcode = '42501';
  end if;
  if r = 'admin' and new.bursary_pct is distinct from old.bursary_pct then
    raise exception 'Only the Executive Director or the Bursary Officer can change a bursary.' using errcode = '42501';
  end if;
  return new;
end $$;
