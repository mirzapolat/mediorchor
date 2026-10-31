-- A label can also be the project's exclusion rule ("Ausschlussregel"):
-- whoever meets its conditions may no longer sing in the project. They are
-- left out of the audition rule, marked on the Fehlzeiten page and told on
-- "Meine Teilnahme". At most one per project, like the audition rule
-- (migration 0034). The kinds are a CHECK, so the table is rebuilt (SQLite
-- can't change a CHECK in place); nothing references it.
create table absence_labels_new (
  id         text primary key default (uuid()),
  project_id text not null references projects (id) on delete cascade,
  name       text not null,
  conditions json not null default '[]',
  is_public  boolean not null default 0,
  position   integer not null default 0,
  created_at text not null default (now_iso()),
  kind       text not null default 'tag' check (kind in ('tag', 'audition', 'exclusion'))
);

insert into absence_labels_new (id, project_id, name, conditions, is_public, position, created_at, kind)
select id, project_id, name, conditions, is_public, position, created_at, kind from absence_labels;

drop table absence_labels;
alter table absence_labels_new rename to absence_labels;

create index absence_labels_project_idx on absence_labels (project_id, position);
create unique index absence_labels_one_audition_idx on absence_labels (project_id) where kind = 'audition';
create unique index absence_labels_one_exclusion_idx on absence_labels (project_id) where kind = 'exclusion';
