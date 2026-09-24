-- Optional end of a registration form: from this moment (ISO 8601 timestamp,
-- UTC) the public form takes no more registrations. Null = open until
-- deactivated. Only applies to the form source, not to webhooks.
alter table registration_pages add column closes_at text;
