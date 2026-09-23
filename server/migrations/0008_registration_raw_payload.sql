-- The fields a webhook registration arrived with, so pending registrations can
-- be re-mapped when the page's field mapping changes. Null for form sign-ups,
-- older webhook entries and rows a manager edited by hand.
alter table registrations add column raw_payload json;
