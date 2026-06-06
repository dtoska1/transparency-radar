# CLAUDE.md — Transparency Radar Albania

Civic transparency platform aggregating Albanian municipal documents with tamper-evidence
(SHA-256 + RFC 3161 timestamps). This file is the source of truth for conventions and
invariants. Read it before planning or editing. Do not re-derive any rule below — they are
load-bearing and several are tied to migrations.

## Scope (v1)
- 5 municipalities only: Tiranë, Shkodër, Durrës, Vlorë, Pogradec.
- 3 verticals: vendime (council decisions), konsultime (consultations), prokurime (procurement).
- Official municipal sites only. Single labeled exception: Vlorë vendime via `vendime.al`
  (`is_unofficial_proxy=true`). APP portal for all procurement. History from 2023.

## Repo & commands
- pnpm monorepo: packages `shared`, `db`, `api`, `scrapers`, `admin`. Node 22, pnpm 9,
  TypeScript strict ESM, Express 5 + Zod, Drizzle ORM, Postgres 16, Biome, Vitest.
- Run all pnpm/typecheck commands from the **inner** repo dir (the path has a space in the
  outer folder and a hyphen in the inner — only the inner dir works).
- Scripts: `db:up` (docker compose up -d postgres), `db:down`, `db:migrate`, `db:studio`,
  `lint` (biome check), `typecheck`, `test` (vitest run), `build`.
- **Merge gate:** `pnpm lint && typecheck && test && build` must be green before any merge.

## Workflow
- Plan first → execute in Plan mode with manual approval → human verifies → review before merge.
- Auto-accept only trivial removals. Significant changes always require approval.
- (If using Codex as well: mirror this file's content to `AGENTS.md`.)

## Locked invariants — never change without a migration
- **Review gate:** `review_status='approved'` is hardcoded server-side and is NEVER a client
  parameter. Only `approved` rows are public. This is the core integrity property.
- **Bulk-approve endpoint:** requires `municipality` scoped AND explicit `dryRun:false`.
- **Dedup keys (locked formulas):**
  - vendime: `vendime:{slug}:{number_normalized}:{year_signed}`
  - konsultime: `konsultime:{slug}:{title_slug}:{published_date_iso}`
  - prokurime: `prokurime:app:{app_id}`
- **Storage keys are hash-derived:** `{muni}/{vertical}/<sha256>.<ext>` — never the remote
  filename. `.zip` is stored as-is (faithful to what the municipality published).
- **published_date:** cast to `::text` in queries. The pg driver otherwise converts DATE
  columns to UTC timestamps (historical timezone-bleed bug).
- **Albanian FTS:** `to_tsvector('simple')` with generated tsvector columns + GIN indexes.
  Custom dictionary deferred to a future migration.
- **Vlorë exception** lives in DATA (`is_unofficial_proxy`, `label_override`), not in render
  logic. Special cases never branch in the view layer.
- **APP procurement:** five separate source rows (one per municipality), contracting-authority
  name held in `filter_config` jsonb — enables per-municipality scrape telemetry.
- **Append-only tables:** `documents`, `document_versions`, `document_checks`, `audit_log`.
  No UPDATE/DELETE in application code.

## Data integrity (hard-won)
- Agent/MCP query results are NOT authoritative. Anything destined for a donor, report, or any
  external claim must be re-verified with direct SQL against Postgres, bypassing the model:
  `docker compose exec -T postgres psql -U tra -d tra -c "..."`.
- The `documents` table has no municipality or vertical column. Per-municipality document counts
  require joining through `{vertical}_documents` → `document_versions` → `documents`.
- Tamper-evidence is the differentiator: every document is hashed on first ingest, stored
  permanently, re-verified weekly (bytes + text diff, two-signal), and FreeTSA-timestamped.

## Environment gotchas
- Docker Desktop must be started manually after a Mac reboot before any DB op or scraper runs.
- zsh: never paste multi-line blocks containing inline `#` comment lines. One command at a time.
- Secrets live in `.env` (gitignored) and Bitwarden under the `TRA / ...` convention.
  Never commit `.env` or `.mcp.json`. `ADMIN_TOKEN` is local-only. Rotate any credential
  exposed in a screenshot.

## Scrapers
- Cheerio for static HTML; undici or Playwright for JS-rendered / header-sensitive sites.
- Always verify idempotency. Backfill with a verification paste-back before merge.
- Inngest for scrape scheduling and queues.
- Tiranë is reachable via undici with honest headers (server-rendered ASP.NET; do not assume a
  WAF block before verifying).
