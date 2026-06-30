-- ============================================================================
-- Storage: public bucket for member photos.
-- ============================================================================

insert into storage.buckets (id, name, public)
  values ('photos', 'photos', true)
  on conflict (id) do nothing;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects
  for select using (bucket_id = 'photos');

drop policy if exists photos_write on storage.objects;
create policy photos_write on storage.objects
  for insert to authenticated with check (bucket_id = 'photos');

drop policy if exists photos_update on storage.objects;
create policy photos_update on storage.objects
  for update to authenticated using (bucket_id = 'photos');
