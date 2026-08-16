# STATE.md

_Last updated: 2026-08-15 — all 14 phases implemented; follow-up: list/photo-cards view toggle + 4×3 / 3×4 one-per-page label templates. Pre-printed labels (print → scan → capture) and Rescan added; all configuration lives in Settings; `docker compose up -d` needs no .env._

## Where things stand

- **Backend** (`apps/server`): Express 4 + Drizzle/pg, ESM, bundled with tsup. 44 integration tests pass (`pnpm test`, needs the dev postgres from `docker-compose.dev.yml`).
- **Frontend** (`apps/web`): Vite + React 18 + Tailwind, react-query, react-router; ~108 kB gzipped JS. Verified in headless Chromium at iPhone 13 and desktop widths.
- **Shared** (`packages/shared`): zod schemas/types consumed by both, imported as TS source (bundled by tsup/Vite — no build step).
- **Docker**: `Dockerfile` (node:20 build → distroless nonroot runtime, bundles `cloudflared`) + `docker-compose.yml` (zero-config). Full stack verified locally with no .env, including the tunnel supervisor.
- **Docs**: README (dev/deploy/tunnel/backup/env), PHASES.md (per-phase status), QUESTIONS.md (decisions + unverified items), CLAUDE.md.

## Known gaps / follow-ups

1. Real Claude API run never happened (no key in the build environment). Set `ANTHROPIC_API_KEY`, upload a tote photo, and check item quality; tune `SYSTEM_PROMPT` in `apps/server/src/services/ai.ts` if needed.
2. Print the calibration PDF on real Avery 5163 stock once; adjust `LABEL_TEMPLATES` geometry if off.
3. Lighthouse mobile pass not measured.
4. `pnpm dev` photo dir is `apps/server/data/photos` (gitignored).
5. No Anthropic key configured yet — paste one in Settings → AI photo analysis (or set `ANTHROPIC_API_KEY`).

## Smoke-test checklist (phone over the tunnel)

- [ ] `docker compose up -d` → open http://localhost:3000 → PIN setup
- [ ] Settings → Remote access → paste Cloudflare token → pill turns Connected → open `https://<host>/`
- [ ] **Add** → create box → label chip shows `A-00N`
- [ ] **Print labels** → select box → Download PDF → prints aligned on Avery 5163 (use calibration page first)
- [ ] Stick label on tote, scan QR with the phone camera while logged out → PIN → lands on the box
- [ ] Print labels → Pre-print 5 blank labels → scan one → box auto-created → capture panel → photo → AI items
- [ ] Repack that tote → scan → Rescan → old photos/AI items replaced, manual items kept
- [ ] Box page → **Take photo** → thumbnail appears → "AI analyzing" pill → items + description filled in
- [ ] Edit an item, add a manual item, seal the box, change its location
- [ ] Home search: item name buried in the AI description finds the box; `A-1` finds A-001…
- [ ] Settings → Export → boxes.csv / items.csv open cleanly in Excel
- [ ] Settings → change PIN → other device is logged out
- [ ] Restart the stack (`docker compose restart`) → photos + data persist; pending AI jobs resume

## Handy commands

```bash
pnpm db:dev && pnpm dev            # local dev
pnpm test                          # API tests
pnpm typecheck && pnpm lint        # static checks
pnpm build                         # web dist + server dist
docker compose up -d --build       # production
docker compose logs -f app         # pino JSON logs
```
