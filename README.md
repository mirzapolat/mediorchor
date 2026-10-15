# mediorchor

Attendance and member management for the Medizinerorchester und -chor e.V., Munich:
projects, members, rehearsals, check-in, public registration, absences and pieces. See [FUNCTIONAL-SPEC.md](FUNCTIONAL-SPEC.md) for the full feature set.

## Proprietary software

Copyright © Medizinerorchester und -chor e.V., Munich. All rights reserved.

This software is proprietary. No part of it may be used, copied, modified,
distributed or published without prior written permission of the
Medizinerorchester und -chor e.V.

## Development

Requires Node.js ≥ 22.18.

```sh
npm install
npm run dev:server   # API server on :3000 (SQLite in ./data)
npm run dev          # frontend on :5173, proxies /api and /files to the server
```

`npm run lint` type-checks frontend and server; `npm run build` builds the frontend into `dist/`.

### Adding a language

Example: Swedish (`sv`).

1. **Register it** in `shared/languages.ts`:
   `sv: { name: 'Svenska', locale: 'sv-SE' },`
   The name appears in the language picker (Account → Language); the locale formats dates and numbers.
2. **Interface texts:** copy `src/locales/en.ts` to `src/locales/sv.ts`, translate the values
   (keep keys and `{placeholders}` as they are; the file starts with `const sv: Messages = {`, like `fi.ts`),
   then add it to `MESSAGES` in `src/lib/i18n.tsx`.
3. **Email texts:** copy `server/locales/en.ts` to `server/locales/sv.ts` and translate it (like `fi.ts`),
   then add it to `MAIL_TEXTS` in `server/i18n.ts`.
4. **Run `npm run lint`.** TypeScript lists every remaining gap: missing keys in the new files and the
   few texts kept next to their code (audit log wording in `src/lib/audit.ts` and
   `src/pages/AdminAuditPage.tsx`, webhook guides in `src/lib/webhookGuides.ts`).
5. Optional: add the language's usual column names (e.g. `fornamn`, `efternamn`) to the import matching in
   `server/fieldMatching.ts` and `src/components/MemberImport.tsx`.

No migration is needed. To make it the default, set `VITE_DEFAULT_LANGUAGE=sv`.

## Deployment

A single container (app, API, SQLite and file storage) behind an external Traefik instance.

```sh
cp .env.example .env   # fill in your values
docker compose up --build -d
```

All data lives in `./data` on the host, so back up that directory. Pushes to the
`production` branch are deployed to the server by `.github/workflows/deploy.yml`.
Admin tasks (reset a password, promote an admin, …) run via
`docker compose exec web node server/cli.ts`.
