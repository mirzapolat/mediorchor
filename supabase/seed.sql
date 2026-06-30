-- ============================================================================
-- Bootstrap the first owner.
--
-- Supabase cannot create an auth user from plain SQL, so do it in two steps:
--
-- 1. Create the auth user (pick ONE):
--    a) Supabase Studio → Authentication → Add user (set email + password), or
--    b) CLI:  supabase auth admin create-user --email owner@example.com --password 'secret'
--
-- 2. Promote that user to owner by running the statement below with their email.
-- ============================================================================

insert into public.app_users (id, email, name, role)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'name', 'Owner'), 'owner'
from auth.users u
where u.email = 'owner@example.com'
on conflict (id) do update set role = 'owner';
