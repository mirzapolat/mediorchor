-- A project's info box at the top of "Meine Teilnahme": a Markdown text and a
-- list of links ([{ "label": "Noten", "url": "https://…" }, …]), edited by
-- everyone who manages the project. At most one row per project; participants
-- only see the box when it has content.
create table project_infos (
  project_id text primary key references projects (id) on delete cascade,
  text       text not null default '',
  links      json not null default '[]',
  updated_at text not null default (now_iso())
);
