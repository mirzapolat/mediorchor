-- Surveys and forms ("Umfragen"; shared/forms.ts has the structure, the
-- server's rules are in server/forms.ts).
--
-- A form keeps the draft its managers edit; publishing it stores an
-- immutable version (form_versions) that respondents answer. Wording can be
-- corrected in place, any change to questions, options, rules or jumps makes
-- a new version. Visibility (listed or link only), access (participants,
-- any account with the link, guests) and identity (named, confidential,
-- anonymous) are independent settings.
create table forms (
  id                   text primary key default (uuid()),
  project_id           text not null references projects (id) on delete cascade,
  title                text not null,
  -- The secret part of the form's link (/f/<token>); rotating it retires
  -- the old link.
  token                text not null unique,
  draft                json not null default '{"settings":{},"items":[]}',
  draft_saved_at       text,
  -- The published version respondents answer (form_versions.id).
  version_id           text,
  status               text not null default 'draft' check (status in ('draft', 'published', 'closed')),
  opens_at             text,
  closes_at            text,
  max_responses        integer check (max_responses is null or max_responses > 0),
  archived             boolean not null default 0,
  listed               boolean not null default 1,
  access               text not null default 'members' check (access in ('members', 'accounts', 'guests')),
  identity             text not null default 'named' check (identity in ('named', 'confidential', 'anonymous')),
  guest_name           text not null default 'required' check (guest_name in ('required', 'optional', 'off')),
  guest_email          text not null default 'optional' check (guest_email in ('required', 'optional', 'off')),
  one_per_account      boolean not null default 1,
  allow_edit           boolean not null default 0,
  guest_edit_link      boolean not null default 0,
  review_before_submit boolean not null default 0,
  show_progress        boolean not null default 1,
  email_copy           boolean not null default 0,
  results_visibility   text not null default 'off' check (results_visibility in ('off', 'after_submit', 'after_close')),
  consent_required     boolean not null default 0,
  consent_text         text not null default '',
  -- Managers told about new responses, and how (never with answers).
  notify_user_ids      json not null default '[]',
  notify_mode          text not null default 'off' check (notify_mode in ('off', 'each', 'daily')),
  notify_sent_at       text,
  notify_sent_count    integer not null default 0,
  published_at         text,
  created_by           text references app_users (id) on delete set null,
  created_at           text not null default (now_iso()),
  updated_at           text not null default (now_iso())
);
create index forms_project on forms (project_id, created_at);

create table form_versions (
  id              text primary key default (uuid()),
  form_id         text not null references forms (id) on delete cascade,
  number          integer not null,
  structure       json not null,
  created_by_name text not null default '',
  created_at      text not null default (now_iso()),
  unique (form_id, number)
);

-- Responses. Each keeps its version and the wording of its questions then.
-- Anonymous responses carry nothing about the respondent: no account, name,
-- email, invitation, edit link or time. Without rowid and with random ids
-- they have no insertion order either, so they can't be lined up with the
-- separately kept participation receipts.
create table form_responses (
  id              text primary key,
  form_id         text not null references forms (id) on delete cascade,
  version_id      text not null,
  answers         json not null,
  snapshot        json not null,
  user_id         text references app_users (id) on delete set null,
  guest_name      text,
  guest_email     text,
  invite_id       text,
  edit_token_hash text,
  submitted_at    text,
  updated_at      text,
  -- Free-text answers marked as checked by a manager (item ids).
  reviewed        json not null default '[]'
) without rowid;
create index form_responses_form on form_responses (form_id);
create index form_responses_user on form_responses (form_id, user_id);

-- "Has taken part": kept apart from the answers, so one response per account
-- (or invitation) also works for anonymous forms. `subject` is "u:<user id>"
-- or "i:<invitation id>".
create table form_receipts (
  form_id    text not null references forms (id) on delete cascade,
  subject    text not null,
  user_id    text references app_users (id) on delete cascade,
  invite_id  text,
  created_at text not null,
  primary key (form_id, subject)
) without rowid;

-- An account's unsent answers (not for anonymous forms; guests keep theirs
-- in the browser).
create table form_drafts (
  form_id    text not null references forms (id) on delete cascade,
  user_id    text not null references app_users (id) on delete cascade,
  answers    json not null,
  page       integer not null default 0,
  updated_at text not null default (now_iso()),
  primary key (form_id, user_id)
) without rowid;

-- Personal one-time links: a guest answers once through theirs.
create table form_invites (
  id         text primary key default (uuid()),
  form_id    text not null references forms (id) on delete cascade,
  token      text not null unique,
  label      text not null default '',
  email      text,
  used_at    text,
  created_at text not null default (now_iso())
);
create index form_invites_form on form_invites (form_id);

-- Uploaded files of file questions, stored privately ("<formId>/<uuid>.<ext>"
-- in the form-files bucket). Waiting for their response until it is sent
-- (then attached; unattached ones go after a day). `secret_hash` proves the
-- uploader. Without rowid, as the responses.
create table form_files (
  id          text primary key,
  form_id     text not null references forms (id) on delete cascade,
  item_id     text not null,
  response_id text,
  secret_hash text not null,
  file_path   text not null,
  file_name   text not null,
  mime        text,
  size        integer not null,
  created_on  text not null
) without rowid;
create index form_files_form on form_files (form_id, response_id);
