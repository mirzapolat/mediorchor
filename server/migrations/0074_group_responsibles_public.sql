-- Participants see who looks after their group on "Meine Teilnahme" while
-- the project shows it (on by default), with a note for them on what the
-- responsibility covers. The internal note (group_notes.note) stays internal.
alter table projects add column show_responsibles boolean not null default 1;
alter table group_notes add column public_note text not null default '';

-- A contact detail its account shows to the participants of a group it is
-- responsible for; private by default.
alter table account_contacts add column public boolean not null default 0;
