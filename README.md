# ToteTrack

Self-hosted home inventory for storage totes. Give every box a printed QR label (`A-014`), snap photos with your phone, and let Claude list what's inside. Search across labels, names, locations, descriptions and items from a single box on the home screen; switch box lists between compact rows and full-width photo cards.

- **Stack:** React 18 + Vite + Tailwind · Node 20 + Express · Drizzle ORM + PostgreSQL 16 · Anthropic API (vision) · pdf-lib labels
- **Deploy:** two containers (`app` distroless + `postgres:16`) via Docker Compose, exposed through a Cloudflare Tunnel
- **Auth:** one shared household PIN → 30-day httpOnly session cookie, rate-limited login

## Quick start (development)

```bash
pnpm install
pnpm db:dev            # starts postgres on localhost:5442 (docker-compose.dev.yml)
cp .env.example .env   # DATABASE_URL already points at the dev DB; set SESSION_SECRET
pnpm db:migrate        # apply migrations (also runs automatically on server boot)
pnpm db:seed           # optional sample data (2 series, 3 locations, 3 boxes)
pnpm dev               # API on :3000, web on :5173 (proxies /api)
```

Open http://localhost:5173, set a PIN, and start adding boxes. Without `ANTHROPIC_API_KEY` the app runs fine; AI analysis is simply disabled.

Other scripts: `pnpm test` (API integration tests against a `totetrack_test` DB on the dev postgres), `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:generate` (new Drizzle migration after editing `apps/server/src/db/schema.ts`).

## Production deployment

```bash
cp .env.example .env
#   set POSTGRES_PASSWORD, SESSION_SECRET (openssl rand -hex 32),
#   PUBLIC_URL=https://totes.example.com  (used inside QR codes)
#   ANTHROPIC_API_KEY=sk-ant-...           (optional)
docker compose up -d --build
```

The `app` container applies migrations on start, serves the built web app and the API on `127.0.0.1:3000`, and stores photos on the `photos` volume; Postgres data lives on `pgdata`. Health: `curl localhost:3000/api/health`.

### Cloudflare Tunnel

Run `cloudflared` on the same host and map a hostname to the app:

```yaml
# ~/.cloudflared/config.yml
tunnel: <TUNNEL-ID>
credentials-file: /home/you/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: totes.example.com
    service: http://localhost:3000
  - service: http_status:404
```

```bash
cloudflared tunnel create totetrack
cloudflared tunnel route dns totetrack totes.example.com
cloudflared tunnel run totetrack        # or install as a service
```

Set `PUBLIC_URL=https://totes.example.com` so printed QR codes deep-link to `https://totes.example.com/b/<label>`. Scanning a label on a logged-out phone shows the PIN screen and then opens the box. The login rate limit keys on `CF-Connecting-IP`; `TRUST_PROXY=1` (default) makes Express honour the tunnel's forwarded headers. For extra hardening put Cloudflare Access in front of the hostname (out of scope here).

### Backups

Two things hold state — back both up on the same schedule:

```bash
# database
docker compose exec -T postgres pg_dump -U tote -Fc totetrack > totetrack-$(date +%F).dump
# photos volume
docker run --rm -v totetrack_photos:/data -v "$PWD":/backup alpine tar czf /backup/photos-$(date +%F).tgz -C /data .
```

Restore with `pg_restore -U tote -d totetrack --clean` and by untarring back into the volume. (Volume names are prefixed with the compose project name, e.g. `totetrack_photos` — check `docker volume ls`.)

### What's configurable where

**Settings page (no restart):** household PIN, Anthropic API key (unless provided by env), AI model, auto-analyze on/off, the AI instructions/prompt, public address used in QR codes, default label sheet, series and locations.
**Environment (`.env`, restart):** database, session secret, port, photo directory, proxy trust, log level — plus optional defaults for the API key, model and public URL.

### Environment variables

| Variable                | Default                 | Notes                                                                                             |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | —                       | `postgres://user:pass@host:5432/db` (compose builds it from `POSTGRES_PASSWORD`)                  |
| `SESSION_SECRET`        | —                       | ≥16 chars, use 32+ random bytes; changing it logs everyone out                                    |
| `PUBLIC_URL`            | `http://localhost:5173` | Default origin for QR payloads (Settings → Public address overrides it); https ⇒ `Secure` cookies |
| `ANTHROPIC_API_KEY`     | unset                   | Optional — a key can also be entered in Settings; the env var wins if both are set                |
| `ANTHROPIC_MODEL`       | `claude-sonnet-5`       | Also editable in Settings                                                                         |
| `PHOTO_DIR`             | `./data/photos`         | `/data/photos` in Docker                                                                          |
| `PORT`                  | `3000`                  |                                                                                                   |
| `TRUST_PROXY`           | `1`                     | Proxy hops in front of the app                                                                    |
| `LOG_LEVEL`             | `info`                  | pino level                                                                                        |
| `APP_PORT` / `APP_BIND` | `3000` / `127.0.0.1`    | Host binding (compose only)                                                                       |

## Labels

Print from **Print labels** (top-right). Default template is Avery 5163 (2"×4", 10/sheet); Avery 5160 (30/sheet) is also included. For a sheet-feed / roll label printer loaded with 4"×3" stock, pick **4" × 3" label (one per page)** (or the 3"×4" portrait variant): every label becomes its own 4×3 page — set the printer's paper size to the label size and print at 100% with no margins. Choose a start position to reuse a partially used sheet, and use the **Calibration page** to check alignment before wasting stock. Print at 100% scale — no "fit to page". Labels never need reprinting when a box moves: location is stored only in the database.

## How the AI works

On upload, each photo is resized (≤1568px) and sent to the configured Claude model with a JSON-only prompt. Items come back as rows tagged **AI** (linked to the photo) and the box description is filled in. Everything is editable. Re-run per photo (gallery ✨ button) or for the whole box (**Re-run AI on all photos**, one multi-image request that replaces the AI rows). Auto-analyze can be turned off in Settings. Pending jobs survive restarts.
