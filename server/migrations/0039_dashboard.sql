-- Each account's own dashboard and start page.

-- Where `/` and signing in lead: 'dashboard', 'projects', 'pieces' or
-- 'calendar' (the last two only when the account may open them; the app falls
-- back to the dashboard otherwise).
alter table app_users add column home_page text not null default 'dashboard'
  check (home_page in ('dashboard', 'projects', 'pieces', 'calendar'));

-- Widget order and visibility: [{ "id": "participation", "hidden": false }, …].
-- Widgets missing from the list are shown after the listed ones.
alter table app_users add column dashboard_layout json not null default '[]';
