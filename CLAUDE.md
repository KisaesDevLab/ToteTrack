# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What ToteTrack is

Self-hosted home inventory for storage totes: printed QR labels (`A-014`) deep-link to a box page; phone photos are analyzed by the Anthropic API into editable item rows + a description; Postgres FTS search is the home screen. Mobile-first React SPA + Express API, deployed as a two-container Docker Compose stack behind a Cloudflare Tunnel. `TOTETRACK-BUILD-PLAN.md` holds the original locked decisions; `PHASES.md` / `STATE.md` / `QUESTIONS.md` track status, follow-ups, and judgment calls (log new blockers to `QUESTIONS.md` and continue with a documented default rather than stopping).

## Commands

```bash
pnpm install
pnpm db:dev                 # dev postgres in docker (localhost:5442, docker-compose.dev.yml)
pnpm dev                    # API :3000 (tsx watch) + web :5173 (vite, proxies /api) — reads root .env
pnpm test                   # server integration tests (vitest+supertest) against DB totetrack_test on the dev postgres
pnpm --filter @totetrack/server test -- test/auth.test.ts   # single test file
pnpm typecheck / pnpm lint / pnpm format
pnpm build                  # web → apps/web/dist, server → apps/server/dist (tsup bundle incl. shared)
pnpm db:generate            # drizzle-kit: new migration in apps/server/drizzle after editing src/db/schema.ts
pnpm db:migrate / pnpm db:seed
docker compose up -d --build   # production (see README)
```

Tests create/migrate `totetrack_test` themselves (`test/global-setup.ts`) and truncate tables per file; they run serially. Set `TEST_DATABASE_URL` to point elsewhere.

## Layout

- `packages/shared/src/index.ts` — zod schemas + types for every API payload; **imported as TypeScript source** by both apps (no build step; tsup `noExternal` and Vite bundle it). Change API shapes here first.
- `apps/server/src` — `app.ts` builds the Express app (`createApp` is what tests use); `index.ts` is the boot entry (migrate → recover pending AI jobs → listen). `routes/*` are thin; logic lives in `services/*` (`boxes`, `photos`, `ai`, `search`, `search-vector`, `labels`, `settings`); `auth/*` has PIN store, session cookie, middleware, routes; `db/schema.ts` + `drizzle/` migrations.
- `apps/web/src` — `api/client.ts` (fetch wrapper, global 401 hook) and `api/hooks.ts` (all react-query hooks + cache invalidation); `App.tsx` is the auth gate + routes; `pages/*`, `components/*`. Path alias `@/` → `src/`.

## Architecture points that span files

- **Auth**: single PIN (argon2 hash in `settings`) → HMAC-signed httpOnly cookie `tt_session` (30 d) carrying a random "generation" stored in `settings` (`session_generation`); changing the PIN keeps other devices logged in, `PinStore.rotateGeneration()` signs out everywhere. Everything under `/api` except `/api/health` and `/api/auth/*` sits behind `requireAuth`; photo files are served through `/api/photos/:id/(thumb|original)` (never public static). Login limited 5/15 min keyed on `CF-Connecting-IP`. The SPA route `/b/:labelId` is the QR target: unauthenticated → `/login?returnTo=…` → box.
- **Labels**: `boxes.label_id` is a Postgres generated column from a denormalised `series_letter` + `number` (`A-001`); numbers come from `series.next_number` under `SELECT … FOR UPDATE` in `createBox`. Location is DB-only, labels never reprint. `normalizeLabelId` (shared) accepts `a1`, `A-1`, `a-001`.
- **Search**: `boxes.search_vector` (tsvector) is rebuilt **app-side inside the same transaction** by `refreshBoxSearchVector` on every box/item/location write — call it whenever you add a write path. Query = `websearch_to_tsquery('english')` + ILIKE/trigram fallback + letter/number-prefix matching (`services/search.ts`).
- **Photos**: multer memory → `file-type` sniff → sharp: original normalised to JPEG (EXIF-rotated) + 400 px WebP thumb under `PHOTO_DIR/<boxId>/`. Deleting a photo also deletes AI items linked to it and rebuilds the box description from remaining per-photo summaries.
- **AI** (`services/ai.ts`): `AiService` = in-process FIFO queue (concurrency 1) with `ai_status` columns; `recoverPending()` on boot re-queues. Prompt asks for JSON `{description, items:[{name,qty,note}]}`; `parseAnalysis` strips fences / extracts the outer object / falls back to description-only. Per-photo run replaces that photo's `source='ai'` rows and sets `photos.ai_description`; box-level run sends all photos in one request and replaces all AI rows. Key comes from `ANTHROPIC_API_KEY` or, if unset, the `anthropic_api_key` setting (`effectiveApiKey`); prompt overridable via `ai_system_prompt`; disabled when neither key exists. Auto-analyze toggle in settings. Tests inject `analyzeOverride` instead of calling the API.
- **Labels PDF** (`services/labels.ts`): template registry (`LABEL_TEMPLATES`, inches) → pdf-lib page per sheet, QR PNG via `qrcode`, `startOffset` for partial sheets, calibration page endpoint; `/api/labels/pdf` marks `printed_at`.
- **Configuration philosophy**: everything a household member changes is a Settings value in the DB (`services/settings.ts` has the `effective*` helpers with env-vs-settings precedence); env is optional plumbing/overrides. `SESSION_SECRET` is generated on first boot if unset (`resolveSessionSecret`); public URL = setting → env → request origin (`effectivePublicUrl(db, env, req)`); `Secure` cookies follow `req.secure`/`X-Forwarded-Proto` per request.
- **Cloudflare tunnel** (`services/tunnel.ts`): `TunnelManager` spawns the bundled `cloudflared` (`CLOUDFLARED_BIN`, copied into the Docker image) with the token from settings/env, parses its log for connected/error, restarts with backoff; status is part of `GET /api/settings`, `POST /api/settings/tunnel/restart`. In the Cloudflare dashboard the public hostname points at `localhost:3000`.

## Conventions

- Express 4 + `asyncHandler`; throw `HttpError` helpers from `lib/errors.ts`; the error middleware maps Multer/JSON errors too. Validate every body/query with the shared zod schemas via `parseBody`/`parseQuery`.
- API returns entities via `mapSummary`/`mapPhoto`/`mapItem` (ISO strings, `thumbUrl`, counts) — reuse `boxSummaryColumns` for anything list-like.
- Frontend: all server state through `api/hooks.ts`; mutations invalidate with `invalidateBoxy`; toasts via `useToast`; Tailwind tokens (`paper`, `ink`, `accent`, `line`) and `.btn-*`/`.input`/`.card` component classes in `index.css`.
- Migrations are committed (`apps/server/drizzle`); the migrator also runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`.

## Out of scope for v1

PWA/offline, move history, multi-user accounts, thermal printing, B2 photo offload, item check-in/out, non-QR barcodes.
