-- ---------------------------------------------------------------------------
-- Registration pages either show the public form or receive entries through
-- a webhook (Google Forms script, Power Automate, Zapier, IFTTT, …). Both feed
-- the same registrations list.
-- ---------------------------------------------------------------------------

alter table registration_pages
  add column source text not null default 'form' check (source in ('form', 'webhook'));

-- Optional explicit field mapping: { first_name, last_name, full_name, email,
-- group_name } → incoming field name. Unset targets are detected automatically.
alter table registration_pages add column webhook_mapping json not null default '{}';

-- Last delivery, to help setting up the integration: { fields, matched }.
alter table registration_pages add column webhook_last_payload json;
alter table registration_pages add column webhook_last_received_at text;
alter table registration_pages add column webhook_last_status text;
