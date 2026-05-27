# Transparency Radar Albania

Transparency Radar Albania (TRA) is a civic transparency platform that aggregates municipal decisions (Vendime), procurement notices (Prokurime), and public consultations (Konsultime) from five Albanian municipalities — Tirana, Shkodër, Durrës, Vlorë, and Pogradec — making public data searchable, watchable, and auditable by citizens and journalists.

## Prerequisites

- [Node.js 22 LTS](https://nodejs.org/) (use `.nvmrc` — `nvm use`)
- [pnpm 9+](https://pnpm.io/) — `npm i -g pnpm`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)

## Quick start

```bash
git clone https://github.com/dtoska1/transparency-radar.git
cd transparency-radar
pnpm install
cp .env.example .env
pnpm db:up
pnpm dev
```

The API will be available at `http://localhost:3000`. Check `GET /api/v1/health`.

## Project structure

```
tra/
├── packages/
│   ├── shared/      # types, constants, adapter interfaces
│   ├── db/          # Drizzle ORM config, schema, migrations
│   ├── api/         # Express public + admin API
│   ├── scrapers/    # scraper modules, Inngest functions
│   └── admin/       # admin panel (Astro + HTMX — future task)
├── .github/workflows/ci.yml
├── docker-compose.yml
├── biome.json
├── tsconfig.base.json
└── package.json
```

## Common scripts

| Script | Description |
|---|---|
| `pnpm dev` | Start API + scrapers in watch mode |
| `pnpm build` | Compile all packages |
| `pnpm lint` | Biome lint check |
| `pnpm format` | Biome format (write) |
| `pnpm test` | Run Vitest suite |
| `pnpm typecheck` | TypeScript type check |
| `pnpm db:up` | Start local Postgres via Docker |
| `pnpm db:down` | Stop Postgres container |
| `pnpm db:migrate` | Run Drizzle migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Tech stack

- **Runtime**: Node.js 22, TypeScript strict, ESM
- **Package manager**: pnpm workspaces
- **API**: Express 5
- **ORM**: Drizzle ORM + postgres-js (Neon-compatible)
- **Validation**: Zod
- **Lint/Format**: Biome
- **Tests**: Vitest
- **Logger**: Pino
- **Error tracking**: Sentry
- **Background jobs**: Inngest
- **Database**: PostgreSQL 16 (local Docker / Neon in prod)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
