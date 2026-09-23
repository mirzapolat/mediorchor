# mediorchor

Attendance and member management for the Medizinerorchester und -chor e.V., Munich:
projects, members, rehearsals, check-in, public registration, absences, pieces and
club members. See [FUNCTIONAL-SPEC.md](FUNCTIONAL-SPEC.md) for the full feature set.

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
