# Azure App Service deployment

Radari Vendor uses three independently deployed surfaces:

- `api.radarivendor.com`: Express API in `packages/api`
- `admin.radarivendor.com`: Astro SSR admin BFF in `packages/admin`
- `radarivendor.com`: Azure Static Web App from `packages/site`

The API and admin are separate Linux custom-container App Service apps. Build both images from the
repository root. Neither container runs migrations or scraper jobs at startup.

## API image

Build:

```bash
docker build -f packages/api/Dockerfile -t radari-vendor-api .
```

The image starts with `node dist/index.cjs`, binds to `0.0.0.0`, and reads `PORT`. Express trusts
exactly one reverse-proxy hop for the direct App Service frontend topology. Reassess that hop count
before adding Azure Front Door, Application Gateway, or another proxy.

Configure these values in **Azure App Settings**, never in a deployed `.env` file:

| Variable | Required | Example / placeholder | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | `postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require` | Neon connection string; secret |
| `ADMIN_SESSION_SECRET` | yes | `<at-least-32-random-characters>` | Secret; never log or return |
| `CORS_ORIGINS` | yes | `https://admin.radarivendor.com` | Comma-separated HTTPS origins; default-deny |
| `NODE_ENV` | yes | `production` | Enables production validation and secure cookies |
| `PORT` | yes | `8080` | Container listen port |
| `WEBSITES_PORT` | yes | `8080` | App Service routing setting; Azure does not inject it into the container |
| `STORAGE_ADAPTER` | yes | `local` | Only currently supported adapter |
| `STORAGE_LOCAL_PATH` | yes | `/app/uploads` | App Service container storage is ephemeral |
| `SENTRY_DSN` | no | `<Sentry DSN>` | Optional error reporting |
| `LOGTAIL_SOURCE_TOKEN` | no | `<Better Stack token>` | Optional log shipping |

`STORAGE_ADAPTER=local` is not durable on App Service. Stored document bytes can disappear when a
container is replaced or restarted. R2 or B2 support is required before treating Azure local
storage as an archive. Database metadata and hashes do not replace the original bytes.

Apply reviewed database migrations as a separate, explicit release step. The container does not
run `db:migrate`.

## Admin image

Build:

```bash
docker build -f packages/admin/Dockerfile -t radari-vendor-admin .
```

The image starts with `node scripts/start.mjs`. The browser talks only to Astro; the BFF forwards
only the `tra_admin_session` cookie to the API and relays upstream `Set-Cookie` headers.
Astro validates the forwarded host against the exact production domain. Because the installed
standalone Node adapter does not reconstruct the request protocol from `X-Forwarded-Proto`, every
mutating BFF route also applies the shared exact-origin guard for
`https://admin.radarivendor.com`.

| Variable | Required | Example / placeholder | Notes |
| --- | --- | --- | --- |
| `ADMIN_API_BASE_URL` | yes | `https://api.radarivendor.com` | Must be HTTPS in production |
| `NODE_ENV` | yes | `production` | Enables fail-closed runtime validation |
| `PORT` | yes | `8080` | Container listen port |
| `WEBSITES_PORT` | yes | `8080` | App Service routing setting |

The admin does not need `DATABASE_URL`, `ADMIN_SESSION_SECRET`, or a browser CORS allow-list. It is
a server-side BFF and uses the API session cookie.

Health endpoints:

- API: `/api/v1/health`
- Admin: `/health`

## Provision the first production administrator

The normal `admin:create` command remains local-DEV-only. Production provisioning is a guarded
one-off command run from a trusted local checkout after the auth migration has been applied.

Enter the Neon URL without echoing it, then run the interactive command:

```bash
read -rsp "Neon DATABASE_URL: " DATABASE_URL
echo
export DATABASE_URL
export TRA_ALLOW_PROD_ADMIN_PROVISION=I_UNDERSTAND_THIS_WRITES_NEON
pnpm admin:provision-prod
unset DATABASE_URL TRA_ALLOW_PROD_ADMIN_PROVISION
```

The command requires a TTY, a `.neon.tech` PostgreSQL host, hidden password confirmation, and an
exact target confirmation. It locks and inspects `admin_users` in one transaction and refuses to
write if any administrator already exists. It never prints the password, password hash, connection
URL, or session secret.

## Apex holding page

Create an Azure Static Web App with:

- app location: `packages/site`
- API location: empty
- output location: empty

Point the apex `radarivendor.com` custom domain at that Static Web App. The holding page is isolated
from both authenticated services and contains no API or admin wiring.

## Logging

Pino redacts `Authorization`, `Cookie`, and `Set-Cookie` headers. Startup validation reports only
missing or invalid variable names; it does not print `DATABASE_URL` or `ADMIN_SESSION_SECRET`.
