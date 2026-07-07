-- ============================================================================
-- Bootstrap the first admin.
--
-- Supabase cannot create an auth user from plain SQL, so do it in two steps:
--
-- 1. Create the auth user (pick ONE):
--    a) Supabase Studio → Authentication → Add user (set email + password), or
--    b) CLI:  supabase auth admin create-user --email admin@example.com --password 'secret'
--
-- 2. Promote that user to admin by running the statement below with their email.
-- ============================================================================

insert into public.app_users (id, email, name, is_admin)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'name', 'Admin'), true
from auth.users u
where u.email = 'admin@example.com'
on conflict (id) do update set is_admin = true;
