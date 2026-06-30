# Anwesenheit

Self-hosted choir **attendance management** platform. Track who attended which
event across multiple projects, with a calm, minimal, Notion-inspired UI.

- **Frontend:** React + Vite + TypeScript
- **Styling:** Tailwind CSS (fully custom, no component library)
- **Backend:** Supabase (auth, Postgres, storage)
- **Icons:** Lucide React
- **Languages:** German / English (switchable, default set via env)

Everything is customisable through environment variables. Runs with
`npm run dev` for development and ships as a single Docker image for self-hosting.

---

## 1. Set up Supabase

You can use Supabase Cloud or a self-hosted Supabase instance. The database is
managed as **tracked migrations** in `supabase/migrations/`, applied with the
[Supabase CLI](https://supabase.com/docs/guides/cli).

```sh
# one-time
brew install supabase/tap/supabase    # or see the CLI install docs
supabase login
supabase link --project-ref <your-project-ref>   # ref is in Project Settings → General

# apply all migrations (tables, RLS, storage bucket)
supabase db push

# deploy the user-creation edge function (lets the owner add users from the UI)
supabase functions deploy admin-create-user
```

`supabase db push` records applied migrations in a `supabase_migrations.schema_migrations`
table, so re-running only applies new files. To iterate locally instead, run
`supabase start` and `supabase db reset`.

Then create the first **owner** account:

1. In **Authentication → Add user**, create a user with an email + password.
2. Edit [`supabase/seed.sql`](supabase/seed.sql), set that email, and run it
   (SQL Editor, or `psql "$DATABASE_URL" -f supabase/seed.sql`) to promote the
   user to `owner`.

**SMTP / email:** in **Authentication → Settings → SMTP**, point Supabase at your
own mail server (see the `SMTP_*` vars in `.env.example`). This powers invites,
password resets, and email-change confirmations.

## 2. Configure

Copy the example env file and fill in your Supabase URL + anon key:

```sh
cp .env.example .env
```

| Variable                  | Purpose                                   |
| ------------------------- | ----------------------------------------- |
| `VITE_SUPABASE_URL`       | Supabase project URL                      |
| `VITE_SUPABASE_ANON_KEY`  | Supabase anon/public key                  |
| `VITE_DEFAULT_LANGUAGE`   | `de` or `en` (default UI language)        |
| `VITE_APP_NAME`           | App name shown in the sidebar / title     |
| `VITE_ACCENT_COLOR`       | Accent colour                             |
| `PORT`                    | Host port for the Docker container        |

## 3. Run

**Development**

```sh
npm install
npm run dev
```

**Production (Docker)**

```sh
docker compose up -d --build
```

The image reads `VITE_*` from the container environment **at start-up** (via
`docker/env.sh`), so the same image can be reconfigured without rebuilding.

---

## How it works

- **No landing page.** Users sign in, then land on the project dashboard.
- **Workspace sidebar:** Projects · Users, with account + sign-out at the bottom.
  Only the **admin** sees Users.
- **Projects** are created, edited, archived, and deleted (name + optional
  description).
- **Users** all share access to every project. Exactly one admin; the admin role
  can be transferred. The admin creates users who then log in.
- **Branding** (app name, accent colour) is configured via `VITE_*` env vars; the
  logo is the favicon.
- Inside a project (**Events · Members · Settings**):
  - **Members** have first/last name, optional group, email, and photo. They can
    be previewed, edited, archived (hidden) or deleted (removed entirely).
  - **Events** have a name and optional date/time. Opening an event shows the
    attendance list — every member starts as *absent* and is toggled to
    *present* or *excused* with one click. People can be added on the fly as a
    one-off **guest** or as a permanent **project member**.

## Project structure

```
src/
  components/   Reusable UI (Button, Input, Card, Modal, Overlay, Table…)
  layouts/      SidebarLayout for the workspace and for a project
  pages/        Route-level pages
  hooks/        useAuth
  lib/          Supabase client, config, i18n, helpers
  types/        Shared TypeScript types
supabase/
  config.toml   CLI config (link + local dev)
  migrations/   Tracked SQL migrations (tables, RLS, storage)
  seed.sql      Promote the first owner
  functions/    admin-create-user edge function
docker/         nginx config + runtime env injection
```
