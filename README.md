# ToteTrack

Self-hosted home inventory for storage totes. Give every box a printed QR label (`A-014`), snap photos with your phone, and let Claude list what's inside. Search across labels, names, locations, descriptions and items from a single box on the home screen; switch box lists between compact rows and full-width photo cards.

- **Stack:** React 18 + Vite + Tailwind · Node 22 + Express · Drizzle ORM + PostgreSQL 16 · Anthropic API (vision) · pdf-lib labels
- **Deploy:** two containers (`app` distroless + `postgres:16`) via Docker Compose, exposed through a Cloudflare Tunnel
- **Auth:** one shared household PIN → 30-day httpOnly session cookie, rate-limited login

## Quick start (development)

```bash
pnpm install
pnpm db:dev            # starts postgres on localhost:5442 (docker-compose.dev.yml)
cp .env.example .env   # DATABASE_URL already points at the dev DB (everything else optional)
pnpm db:migrate        # apply migrations (also runs automatically on server boot)
pnpm db:seed           # optional sample data (2 series, 3 locations, 3 boxes)
pnpm dev               # API on :3000, web on :5173 (proxies /api)
```

Open http://localhost:5173, set a PIN, and start adding boxes. Without `ANTHROPIC_API_KEY` the app runs fine; AI analysis is simply disabled.

Other scripts: `pnpm test` (API integration tests against a `totetrack_test` DB on the dev postgres), `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:generate` (new Drizzle migration after editing `apps/server/src/db/schema.ts`).

## Production deployment

**On any host with Docker (no checkout needed):**

```bash
mkdir -p ~/totetrack && cd ~/totetrack
curl -fsSLO https://raw.githubusercontent.com/KisaesDevLab/ToteTrack/main/deploy/docker-compose.yml
docker compose up -d
```

**From a checkout of this repo** (builds the image locally): `docker compose up -d --build`

Images are published to **GHCR** by `.github/workflows/docker.yml` on every push to `main` (`:latest`, `:main`, `:sha-…`) and on version tags (`v1.2.3` → `:1.2.3`, `:1.2`), for `linux/amd64` and `linux/arm64`. CI (`ci.yml`) runs typecheck, lint, the web build and the test suite against Postgres 16.

That's it — no `.env` needed. Open http://localhost:3000 (or the tunnel hostname), set the household PIN, then configure everything else from **Settings**:

- **AI photo analysis** — paste your Anthropic API key, pick the model, tune the prompt, toggle auto-analyze
- **Remote access (Cloudflare Tunnel)** — paste a tunnel token; the app runs the connector itself and shows live status
- **Public address** — auto-detected from the address you're using; pin it if you print labels from several addresses
- **Labels**, **series**, **locations**, **PIN**, **exports**

The `app` container applies migrations on start, generates and stores a session secret on first boot, serves the built web app and the API on `127.0.0.1:3000`, and stores photos on the `photos` volume; Postgres data lives on `pgdata`. Health: `curl localhost:3000/api/health`. Environment variables (see `.env.example`) are optional overrides only.

### Cloudflare Tunnel (from the Settings page)

1. Cloudflare Zero Trust → **Networks → Tunnels → Create a tunnel** (Cloudflared).
2. Add a **Public Hostname** (e.g. `totes.example.com`), service type **HTTP**, URL **`localhost:3000`** — the connector runs inside the app container.
3. Copy the connector token from the install command and paste it into **Settings → Remote access**. The status pill turns **Connected** within a few seconds; the log tail is available for troubleshooting.
4. Open the app on the new hostname; QR codes will use it automatically (`https://totes.example.com/b/<label>`). Scanning a label on a logged-out phone shows the PIN screen and then opens the box.

Login is rate-limited per client address (5 failures / 15 min) plus a global cap; the client address comes from `req.ip`, which only honours `X-Forwarded-For` from **trusted proxies**. `TRUST_PROXY` defaults to `loopback` — the bundled `cloudflared` inside the container — so a LAN client cannot spoof its way past the limiter with a forged header. Running your own connector or reverse proxy on another host? Set `TRUST_PROXY` to its address/CIDR (`10.0.0.5`, `172.16.0.0/12`, `uniquelocal`) or a hop count. Session cookies are marked `Secure` whenever a request arrives over https, and **Settings → Security → Sign out everywhere** revokes every device at once. For extra hardening put Cloudflare Access in front of the hostname (out of scope here). You can still run `cloudflared` yourself instead — set `CLOUDFLARE_TUNNEL_TOKEN` in the environment (it overrides the Settings value) or point an external connector at `http://localhost:3000`.

### Backups

Two things hold state — back both up on the same schedule:

```bash
# database
docker compose exec -T postgres pg_dump -U tote -Fc totetrack > totetrack-$(date +%F).dump
# photos volume
docker run --rm -v totetrack_photos:/data -v "$PWD":/backup alpine tar czf /backup/photos-$(date +%F).tgz -C /data .
```

Restore with `pg_restore -U tote -d totetrack --clean` and by untarring back into the volume. (Volume names are prefixed with the compose project name, e.g. `totetrack_photos` — check `docker volume ls`.)

> The database dump contains the settings table — including the **Anthropic API key**, **tunnel token** and the **session secret** you entered in the UI (the PIN is stored only as an argon2 hash). Treat dumps like a password file: encrypt them (`age`, `gpg`) or keep them on a private disk.

### What's configurable where

**Settings page (everything a household needs, no restart):** PIN, Anthropic API key, model, auto-analyze, AI prompt, Cloudflare tunnel token (with live status), public address (auto-detected by default), default label sheet, series, locations.

**Environment (optional overrides / plumbing):**

| Variable                  | Default                      | Notes                                                                |
| ------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`            | compose builds it            | `postgres://user:pass@host:5432/db`                                  |
| `POSTGRES_PASSWORD`       | `totetrack`                  | compose only; DB is not exposed outside the compose network          |
| `SESSION_SECRET`          | auto-generated & stored      | set to control it yourself                                           |
| `ANTHROPIC_API_KEY`       | unset                        | overrides the key entered in Settings                                |
| `ANTHROPIC_MODEL`         | `claude-sonnet-5`            | default model (Settings overrides)                                   |
| `CLOUDFLARE_TUNNEL_TOKEN` | unset                        | overrides the token entered in Settings                              |
| `CLOUDFLARED_BIN`         | `/usr/local/bin/cloudflared` | connector binary path (bundled in the image; set for local dev)      |
| `PUBLIC_URL`              | unset                        | fixed QR origin (Settings overrides; else auto-detected per request) |
| `PHOTO_DIR`               | `./data/photos`              | `/data/photos` in Docker                                             |
| `PORT`                    | `3000`                       |                                                                      |
| `TRUST_PROXY`             | `loopback`                   | Express `trust proxy` (addresses/CIDRs, `uniquelocal`, or hop count) |
| `LOG_LEVEL`               | `info`                       | pino level                                                           |
| `APP_PORT` / `APP_BIND`   | `3000` / `127.0.0.1`         | Host binding (compose only)                                          |

## Pre-printed labels & scanning workflow

The intended packing loop is _print first, fill later_:

1. **Print labels → Pre-print blank labels**: pick a series and a count (e.g. 30). The next 30 numbers are reserved (auto-numbering skips them) and a PDF of blank labels downloads. Stick them on empty totes.
2. Pack a tote, then **scan its label** with the phone camera. Because the label is pre-printed and unclaimed, the box is created with that exact number and opens straight into **Scan the contents**: take one or more photos and the AI lists the items and writes the description (or add items by hand if AI is off).
3. When a tote is repacked, scan its label again: the **Rescan** panel opens by itself (Settings → _Open the camera panel after scanning_). Take one or several photos, tap **Save & analyze** — the fresh photos replace the previous ones and the AI-suggested items; manual items are kept. Untick _Replace_ to add photos alongside the old ones instead.

Use the in-app **Scan** button (top bar) to read labels with a live camera preview and stay in the app between totes; the phone's own camera app works too. Camera access needs https (the tunnel hostname) or localhost — there's a type-the-label fallback.

Unclaimed pre-printed labels are listed under the pre-print card (void a misprint there) and counted per series in Settings.

## Labels

Print from **Print labels** (top-right). Default template is Avery 5163 (2"×4", 10/sheet); Avery 5160 (30/sheet) is also included. For a sheet-feed / roll label printer loaded with 4"×3" stock, pick **4" × 3" label (one per page)** (or the 3"×4" portrait variant): every label becomes its own 4×3 page — set the printer's paper size to the label size and print at 100% with no margins. Choose a start position to reuse a partially used sheet, and use the **Calibration page** to check alignment before wasting stock. Print at 100% scale — no "fit to page". Labels never need reprinting when a box moves: location is stored only in the database.

## How the AI works

On upload, each photo is resized (≤1568px) and sent to the configured Claude model with a JSON-only prompt. Items come back as rows tagged **AI** (linked to the photo) and the box description is filled in. Everything is editable. Re-run per photo (gallery ✨ button) or for the whole box (**Re-run AI on all photos**, one multi-image request that replaces the AI rows). Auto-analyze can be turned off in Settings. Pending jobs survive restarts.
