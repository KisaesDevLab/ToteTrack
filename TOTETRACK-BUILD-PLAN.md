# ToteTrack — Home Inventory Build Plan

Working name: **ToteTrack** (rename freely; affects package name, Docker image tag, and page title only).

Self-hosted home inventory app for storage totes. Mobile-first responsive web app, Docker Compose deployment, Cloudflare Tunnel access.

---

## Locked Design Decisions

| Area         | Decision                                                                                                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stack        | React 18 + TypeScript (Vite), Node 20 + Express, Drizzle ORM, PostgreSQL 16. No Redis/BullMQ — AI jobs run in-process async with a status column.                                                                                                                                                            |
| Packaging    | Two-container Docker Compose: `app` (distroless multi-stage) + `postgres:16`. Photos on a named volume. GHCR distribution optional.                                                                                                                                                                          |
| Access       | Cloudflare Tunnel → stable public hostname. QR codes embed `https://<host>/b/<labelId>` deep links scannable by native camera apps.                                                                                                                                                                          |
| Auth         | Shared PIN → signed httpOnly session cookie (30-day). Rate-limited (5 attempts / 15 min / IP). Optional hardening: Cloudflare Access in front (out of scope, documented).                                                                                                                                    |
| Labels       | Arbitrary series: one letter + zero-padded number (e.g., `A-014`). Letter series user-defined; numbers auto-increment per series. Location stored in DB only — labels never need reprinting on moves.                                                                                                        |
| QR           | URL deep link to box page. Unauthenticated scan lands on PIN screen, then redirects to the box.                                                                                                                                                                                                              |
| Label output | PDF generation for Avery sheets. Default template: Avery 5163 (2" × 4", 10/sheet). Template system supports adding other Avery formats later. Print queue: select boxes → generate positioned PDF (with start-offset for partially used sheets).                                                             |
| Locations    | Flat list, CRUD, assignable per box. Current location only, no move history.                                                                                                                                                                                                                                 |
| Photos       | Multiple per box, ordered, swipeable gallery. Original + generated thumbnail (400px WebP) on local volume. Camera capture via `<input type="file" accept="image/*" capture="environment">`.                                                                                                                  |
| AI           | Anthropic API direct (key via env var). Auto-analyze on photo upload. Output: itemized rows (name, qty, optional note) + description blob. Both fully editable afterward. Re-run button per photo and per box (box-level = all photos in one request). Model: `claude-sonnet-4-6` default, env-configurable. |
| Search       | Postgres FTS (tsvector, `english`) across label ID, box name, location name, AI description, item rows. Single search bar as home screen. Trigram fallback for partial label matches.                                                                                                                        |
| Mobile       | Responsive web app (no PWA/service worker in v1). Mobile-first layouts, large touch targets.                                                                                                                                                                                                                 |
| Extras       | Box `sealed`/`open` status toggle. CSV export (boxes + items, two files or one denormalized).                                                                                                                                                                                                                |

## Repo Conventions

- pnpm workspaces: `apps/web`, `apps/server`, `packages/shared` (zod schemas + types).
- `CLAUDE.md`, `PHASES.md`, `STATE.md`, `QUESTIONS.md` at repo root per standard convention.
- Drizzle migrations committed; `drizzle-kit` for generation, programmatic migrate on container start.
- All decisions in this document are final — do not pause to ask unless a true blocker arises (log to QUESTIONS.md and continue with the documented default).

## Data Model

```
series        (id, letter CHAR(1) UNIQUE, description, next_number INT)
locations     (id, name UNIQUE, sort_order)
boxes         (id, series_id FK, number INT, label_id TEXT GENERATED e.g. 'A-014' UNIQUE,
               name TEXT, location_id FK NULL, status ENUM('open','sealed') DEFAULT 'open',
               ai_description TEXT, ai_status ENUM('none','pending','done','error'),
               ai_error TEXT, search_vector TSVECTOR, created_at, updated_at)
photos        (id, box_id FK, sort_order, original_path, thumb_path, width, height,
               ai_status ENUM('none','pending','done','error'), created_at)
items         (id, box_id FK, name TEXT, qty INT DEFAULT 1, note TEXT,
               source ENUM('ai','manual'), photo_id FK NULL, created_at, updated_at)
settings      (key, value)  -- PIN hash (argon2), label template default, AI model
```

Indexes: GIN on `boxes.search_vector`; trigram GIN on `boxes.label_id` and `items.name`; FK indexes. Trigger or app-side refresh of `search_vector` on box/item/location changes (app-side in Drizzle transaction — simpler to debug).

---

## Phases

### Phase 1 — Scaffold & Tooling

Monorepo (pnpm workspaces), TypeScript strict, ESLint/Prettier, Vite React app, Express server with health endpoint, shared zod package. Dev scripts (`pnpm dev` runs both). Dockerfile stub. Write CLAUDE.md/STATE.md.
**Exit:** `pnpm dev` serves web + API locally; `/api/health` returns ok.

### Phase 2 — Database & Migrations

Drizzle schema per data model above, initial migration, programmatic migrator on server boot, seed script (2 series, 3 locations, sample boxes). Connection via `DATABASE_URL`.
**Exit:** clean boot against empty Postgres creates schema; seed populates.

### Phase 3 — Auth (PIN)

Settings-backed argon2 PIN hash. First-run setup screen (no PIN set → force set). Login screen, signed session cookie (30d, httpOnly, secure, sameSite=lax), middleware guarding all `/api/*` except health/login. express-rate-limit on login (5/15min/IP, keyed on CF-Connecting-IP). PIN change in settings UI.
**Exit:** unauthenticated API calls 401; login flow works; rate limit verified.

### Phase 4 — Series, Locations, Boxes CRUD (API)

REST endpoints: series CRUD (letter validation, next_number management with row lock on create), locations CRUD, boxes CRUD (create = pick series → atomically assign next number → generate label_id). Status toggle endpoint. Zod validation on all inputs. Search_vector refresh on writes.
**Exit:** API integration tests pass for create/read/update/delete + concurrent box creation assigns unique numbers.

### Phase 5 — Core Mobile UI Shell

App layout: bottom nav (Search/Home, Boxes, Add, Locations, Settings). Mobile-first Tailwind (or CSS modules — pick one, stay consistent). Box list (label chip, name, location badge, sealed icon, thumbnail). Box create/edit forms. Location manager. Series manager in settings.
**Exit:** full CRUD achievable from a phone-sized viewport with no desktop-only interactions.

### Phase 6 — Photo Upload & Gallery

Multer (or busboy) upload endpoint → validate mime/size (20MB cap) → store original under `/data/photos/<boxId>/`, generate 400px WebP thumb via sharp, record row. Multi-select upload + camera capture input. Box detail page: swipeable gallery (touch-friendly, e.g., embla-carousel), tap for full-screen viewer, reorder + delete. Static file serving with auth check (photos are behind session, not public).
**Exit:** phone camera → upload → thumbnail grid → swipe gallery works; originals not accessible without session.

### Phase 7 — QR Deep Links & Box Page

Route `/b/:labelId` resolves to box detail (case-insensitive). Unauthenticated → PIN screen with `returnTo`, redirect after login. 404 page for unknown labels with "create this box?" shortcut.
**Exit:** scanning a QR URL on a logged-out phone lands on PIN then the correct box.

### Phase 8 — Label PDF Generation

Server-side PDF via pdf-lib: label template registry (Avery 5163 default: geometry, rows/cols, margins). Each label: large letter-number text + QR (qrcode lib → PNG embed) + optional box name line. Print queue UI: select boxes (or "all unprinted"), choose start position offset for partial sheets, download PDF. Mark printed flag optional (nice-to-have, skip if friction).
**Exit:** generated PDF prints correctly aligned on Avery 5163 stock (verify geometry against spec, include a calibration/test page option).

### Phase 9 — Anthropic Vision Analysis

Server module: on photo upload completion, set ai_status=pending and fire in-process async job (simple promise queue, concurrency 1, survives via re-scan of pending on boot). Request: image (resized to ≤1568px longest edge, JPEG) + prompt instructing JSON-only response `{description: string, items: [{name, qty, note?}]}`. Parse defensively (strip fences, fallback to blob-only on parse failure). Merge strategy: append new items tagged source='ai' + photo_id; box ai_description = latest box-level analysis or concatenated per-photo summaries. Per-photo and per-box re-run endpoints (box-level sends all photos in one multi-image request and replaces AI-sourced rows after confirm). Error path: ai_status=error with message, retry button. Cost guard: skip auto-analyze if `ANTHROPIC_API_KEY` unset; setting to disable auto-run.
**Exit:** upload a tote photo → items + description appear without user action; re-run and error paths verified.

### Phase 10 — Items Editing

Item list on box page: inline edit name/qty/note, add manual item, delete, bulk delete AI items. Description blob editable (textarea, autosave). Visual distinction ai vs manual source.
**Exit:** all edits persist and reflect in search.

### Phase 11 — Search (FTS)

tsvector build: label_id, box name, location name, ai_description, aggregated item names/notes. Endpoint with websearch_to_tsquery + trigram ILIKE fallback for short/partial queries (e.g., "A-1"). Home screen = search bar + recent boxes; results show label chip, matched-field hint, thumbnail. Filters: location, status.
**Exit:** searching an item name buried in an AI description finds the box; partial label search works.

### Phase 12 — CSV Export & Settings

Export endpoints: `boxes.csv` (label, name, location, status, description, photo count) and `items.csv` (label, item, qty, note, source). Settings page consolidation: PIN change, AI model + auto-analyze toggle, default label template, export buttons.
**Exit:** CSVs open clean in Excel with correct escaping.

### Phase 13 — Docker & Deployment

Multi-stage Dockerfile (build web → serve static from Express; distroless runtime). docker-compose.yml: app + postgres, named volumes `pgdata` + `photos`, healthchecks, env file template (`DATABASE_URL`, `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `PUBLIC_URL` for QR generation). README: Cloudflare Tunnel config snippet mapping hostname → app:3000, backup notes (pg_dump + photos volume → align with Vibe Vault targets).
**Exit:** `docker compose up -d` on a clean host serves the app end-to-end through the tunnel.

### Phase 14 — Hardening & Polish

Helmet headers, upload mime sniffing (file-type), request logging (pino), 404/error boundaries, loading/skeleton states, empty states, image lazy loading, Lighthouse mobile pass ≥90 performance. Final STATE.md update and smoke-test checklist.
**Exit:** checklist green; smoke test from a phone over the tunnel covering: create box → print label → scan QR → photo → auto AI → edit items → search → export.

---

## Environment Variables

```
DATABASE_URL=postgres://tote:***@postgres:5432/totetrack
SESSION_SECRET=<32+ random bytes>
ANTHROPIC_API_KEY=sk-ant-...        # optional; AI disabled if absent
ANTHROPIC_MODEL=claude-sonnet-4-6
PUBLIC_URL=https://totes.example.com # used for QR payloads
PHOTO_DIR=/data/photos
```

## Out of Scope (v1)

PWA/offline, move history, multi-user accounts, thermal printing (Vibe Print), B2 photo offload, item check-in/out, barcode (non-QR) support.
