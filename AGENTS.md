<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Sisa-Saji project notes

- Spec: `blueprint_sisa_saji.md`. Where the implemented schema differs from the blueprint DDL, `src/db/schema.ts` wins; deviations are listed in `README.md`.
- Single Next.js app: UI in `src/app`, REST API under `src/app/api/v1/*` (response shape `{ success, data, meta?, error? }`).
- DB access: `getDb()` from `@/db` (server-only). Scripts use `createDb()` from `src/db/client.ts`. Drizzle uses `casing: "snake_case"` — camelCase keys in TS.
- Never write `merchants.geom` (generated from latitude/longitude). Radius queries: `ST_DWithin(geom, ST_MakePoint(lng, lat)::geography, meters)`.
- Schema change flow: edit `src/db/schema.ts` → `npm run db:generate` → check the SQL (drizzle-kit quotes `geography(Point, 4326)`; unquote it by hand) → `npm run db:migrate`.
- Domain constants (radius, commission, CO2e factor) live in `src/lib/constants.ts`; pricing logic in `src/lib/pricing/`.
- Local DB without Docker: `npm run db:local` (PGlite + PostGIS, port 5433). Use the `pg` driver; postgres.js breaks against the PGlite socket.
- Before finishing a change: `npm run typecheck && npm run lint && npm run db:verify`. Seeded "tonight" batches expire ~2.5 h after `npm run db:seed`; db:verify then prints a WARN (not a failure) — re-seed to refresh demo data.
- Resetting the local PGlite DB with DROP SCHEMA in a running server leaves PostGIS caches stale ("no spatial operator found"): restart `npm run db:local` afterwards, or delete `.pglite/` while it is stopped.
