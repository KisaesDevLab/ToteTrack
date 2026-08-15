# QUESTIONS.md

Open questions and judgment calls made while building autonomously. Each entry states the decision taken so work could continue; change it if you disagree.

## Decisions taken (please confirm or override)

1. **`label_id` generated column** — Postgres generated columns cannot reference another table, so `boxes` carries a denormalised `series_letter` and `label_id` is `GENERATED ALWAYS AS (series_letter || '-' || lpad(number::text, 3, '0'))`. Series letters are therefore immutable once boxes exist (no rename endpoint).
2. **Deleting a photo removes the AI items derived from it** (source = `ai` and `photo_id` = that photo); manual items are never touched. Plan only said `photo_id FK NULL`; keeping evidence-less AI rows seemed worse than dropping them.
3. **Explicit box number on create** — added an optional `number` to `BoxCreateInput` so scanning an unknown label (e.g. a pre-printed `A-014`) can create exactly that box. `next_number` advances past it when needed.
4. **Per-photo AI summary column** — added `photos.ai_description` so the box description can be rebuilt as the concatenation of per-photo summaries (plan: "concatenated per-photo summaries"). A box-level re-run replaces the box description outright.
5. **Model default is `claude-sonnet-5`** (you chose this over the plan's `claude-sonnet-4-6`); env-configurable (`ANTHROPIC_MODEL`) and editable in Settings.
6. **Originals normalised to JPEG** on upload (HEIC etc. become browser-viewable); full resolution kept, EXIF orientation applied. Thumbnails are 400px WebP as planned.
7. **Photo file layout** — `PHOTO_DIR/<boxId>/<timestamp>-<rand>.jpg` + `.thumb.webp`. In dev `PHOTO_DIR=./data/photos` resolves relative to `apps/server` when run through pnpm.
8. **Second label template (Avery 5160)** included alongside the default 5163 to prove the template registry; geometry from Avery's published specs, verified only via the calibration page (no physical print).
9. **Dev database** — added `docker-compose.dev.yml` (postgres on `localhost:5442`) since no local Postgres was listening on 5432. Tests use `totetrack_test` on the same container.
10. **CSV export** — `boxes.csv`, `items.csv`, plus (at your request) a combined `inventory.csv` (one row per item, box columns repeated; empty boxes still get a row). Formula-injection characters are neutralised with a leading `'`.
11. **Search** — FTS on `english` plus `simple` for the label token, trigram/ILIKE fallback, and explicit letter+number-prefix matching for inputs like `A-1` / `a12`.
12. **Sessions** — cookies embed a random `session_generation` setting (not the PIN hash), so changing the PIN keeps other devices logged in (your choice). `PinStore.rotateGeneration()` exists for a future "sign out everywhere" button.
13. **`items.qty` allows 0** (manual "used up" marker) while AI items are coerced to ≥1.

14. **4×3 label printer** — added two one-label-per-page templates: `label-4x3` (4" wide × 3" tall, landscape) and `label-3x4` (portrait), stacked layout (big label ID, QR, name). I don't know your printer's exact stock orientation or model, so both are offered; delete the one you don't use in `apps/server/src/services/labels.ts` if it clutters the list. Printer driver must be set to a 4×3 (or 3×4) paper size, 100% scale, no margins.
15. **List vs photo-cards view** — the toggle (top of Search and Boxes) is a per-device preference stored in `localStorage`, not a server setting.

## Not verified (needs a human / real hardware)

- **4×3 labels on your sheet-feed printer** — PDF geometry rendered and inspected (see `label-4x3` / `label-3x4`), but not printed on the actual device.

- **Real Anthropic API call** — no `ANTHROPIC_API_KEY` was available in this environment; the pipeline is covered by tests with a stubbed model. First real upload should be checked for prompt quality.
- **Physical Avery 5163 print alignment** — only the calibration PDF was generated; please print it once at 100% scale.
- **Lighthouse ≥90 mobile** — not run (no Lighthouse in this environment). Bundle is ~108 kB gzipped JS, images lazy-load, no blocking fonts.
- **Cloudflare Tunnel end-to-end** — compose stack verified locally on `127.0.0.1:3300`; tunnel config is documented in the README but not exercised.
- **HEIC uploads** — sharp's prebuilt libvips includes libheif, but no HEIC sample was available to test.

## Housekeeping

- Committed to `main` on 2026-08-15 at your request. Answered in the Q&A round: keep both 4×3/3×4 templates, default model `claude-sonnet-5`, photo delete removes derived AI items, PIN change keeps other sessions, keep exact-number create, add combined CSV, no API key yet.
