-- Accounts are offered to add contact details (WhatsApp, Signal, …) once,
-- right after the profile photo prompt. Every account, including those made
-- before contact details existed, is asked once: none counts as asked yet.
alter table app_users add column contacts_prompted_at text;
