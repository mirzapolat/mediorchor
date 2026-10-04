-- A label can be the project's audition rule ("Regel zum Vorsingen"): every
-- participant sees on "Meine Teilnahme" whether its conditions apply to them
-- ("Du musst vorsingen") or not. At most one per project; other labels work
-- as before.
alter table absence_labels add column kind text not null default 'tag' check (kind in ('tag', 'audition'));
create unique index absence_labels_one_audition_idx on absence_labels (project_id) where kind = 'audition';
