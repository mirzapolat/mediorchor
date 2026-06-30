-- Warning badges only count unresolved submissions, so keep that lookup small.
create index if not exists checkin_submissions_unrecognized_event_idx
  on public.checkin_submissions (event_id)
  where not recognized;
