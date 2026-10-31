-- The member list is the only truth: a check-in with an account that is not
-- on it (and can't be linked by its confirmed email) no longer adds a member
-- but is listed as unrecognized, like a guest. The account is kept with the
-- submission, so assigning it — or saving it as a new member — also links the
-- account to that member (confirmed by whoever manages the project).
alter table checkin_submissions add column user_id text references app_users (id) on delete set null;
