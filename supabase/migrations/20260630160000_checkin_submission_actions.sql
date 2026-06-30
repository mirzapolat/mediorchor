-- ============================================================================
-- Administrative actions for unrecognized check-in submissions.
-- ============================================================================

drop policy if exists checkin_submissions_delete_authenticated on public.checkin_submissions;
create policy checkin_submissions_delete_authenticated on public.checkin_submissions
  for delete to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = checkin_submissions.event_id
        and public.can_access_project(e.project_id)
    )
  );

-- Assign an unrecognized submission to an existing project member. Attendance
-- and the submission audit row are updated atomically.
create or replace function public.assign_checkin_submission(
  p_submission_id uuid,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_submission record;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select s.event_id, e.project_id, c.attendance_status
    into v_submission
  from public.checkin_submissions s
  join public.events e on e.id = s.event_id
  join public.event_checkins c on c.event_id = s.event_id
  where s.id = p_submission_id
    and not s.recognized;

  if not found then
    raise exception 'Check-in submission not found';
  end if;

  if not public.can_access_project(v_submission.project_id) then
    raise exception 'Project access denied' using errcode = '42501';
  end if;

  select m.id into v_member_id
  from public.members m
  where m.id = p_member_id
    and m.project_id = v_submission.project_id
    and m.status = 'active';

  if not found then
    raise exception 'Member not found in this project';
  end if;

  insert into public.attendance (event_id, member_id, status, is_guest)
  values (v_submission.event_id, v_member_id, v_submission.attendance_status, false)
  on conflict (event_id, member_id)
  do update set status = excluded.status, is_guest = false;

  update public.checkin_submissions
  set member_id = v_member_id,
      recognized = true,
      attendance_status = v_submission.attendance_status
  where id = p_submission_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.assign_checkin_submission(uuid, uuid) from public;
grant execute on function public.assign_checkin_submission(uuid, uuid) to authenticated;
