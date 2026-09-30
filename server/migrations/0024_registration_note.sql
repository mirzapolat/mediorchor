-- An optional extra field on a registration page that only helps managers
-- sort out registrations (e.g. "Who invited you?"). Its value is shown in the
-- registrations list but never carried over to the member on transfer.
-- note_label: the field's label; null = the page has no such field. Form
-- pages ask for it on the public form, webhook pages fill it from the field
-- mapped to "note".
alter table registration_pages add column note_label text;
alter table registrations add column note text;
