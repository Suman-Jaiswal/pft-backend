# PFT Backend Template

NestJS + TypeScript backend template with SOLID architecture for cards, statements, and transactions.

## Stack-

- NestJS (modular monolith)
- Prisma + PostgreSQL
- JWT auth + RBAC
- DTO validation + Zod parsing in application layer
- OpenAPI docs at `/api/docs`

## Quickstart

1. Copy env:
   - `cp .env.example .env`
2. Install:
   - `npm install`
3. Generate prisma client:
   - `npm run prisma:generate`
4. Run migrations:
   - `npm run prisma:migrate:dev`
5. Start:
   - `npm run start:dev`

## Neon (Managed Postgres) Setup

1. Create a Neon project/database and copy connection string.
2. Copy env template:
   - `cp .env.neon.example .env`
3. Set `DATABASE_URL` to your Neon URL and keep `sslmode=require`.
4. Verify connection:
   - `npm run db:check`
5. Apply migrations and generate client:
   - `npm run prisma:generate`
   - `npm run prisma:migrate:deploy`
6. Seed owner user:
   - `npm run seed:owner`
7. Start app:
   - `npm run start:dev`

## Docker (Postgres + App)

- Start full stack:
  - `docker compose up --build`
- App: `http://localhost:3000`
- Swagger: `http://localhost:3000/api/docs`

If you want to run app locally and only DB in Docker:

- `docker compose up -d postgres`
- keep `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/pft_backend`

## CI/CD to Raspberry Pi 5

GitHub Actions pipeline is available for Raspberry Pi deployment in two modes:

- SSH-based deployment from GitHub-hosted runner: `.github/workflows/rpi-cicd.yml`
- Pi-native self-hosted runner deployment: `.github/workflows/rpi-selfhosted-cicd.yml`

Docs: `docs/deployment-rpi5-github-actions.md`

The self-hosted runner mode is appropriate when the Pi can reach GitHub outbound but is not reachable via inbound SSH.

Migration runs on the runner against `PROD_DATABASE_URL`; Pi deploy is Docker container restart only.

## Scripts

- `npm run build`
- `npm run lint`
- `npm run test`
- `npm run test:e2e`
- `npm run seed:owner`
- `npm run db:check`
- `npm run migrate:firestore`

## CC Transaction Import Job (NestJS)

- Endpoint: `POST /api/v1/import-jobs/cc-txn-import`
- Auth header: `X-Job-Token` (set `IMPORT_JOB_TOKEN`)
- Body:
  - `dryRun?: boolean`
  - `bankKeys?: string[]`
- Suggested schedule: every 10 min (`*/10 * * * *`, `Asia/Kolkata`)

Reference docs:

- `docs/domain/cc-txn-import-runtime.md`
- `docs/domain/cc-txn-import-parser-parity.md`
- `docs/domain/cc-txn-import-rollout.md`

Gmail import re-auth (recommended):

- Open: `GET /api/v1/auth/google/import/start`
- Complete consent for Gmail readonly scope
- Callback persists refresh token in `PftSetting` for your tenant
- Configure:
  - `IMPORT_GOOGLE_REDIRECT_URI`
  - `IMPORT_REAUTH_SUCCESS_REDIRECT`
  - `IMPORT_REAUTH_ERROR_REDIRECT`

## Seed Initial Owner User

1. Ensure DB is running and migrated.
2. Set envs (`.env` or shell):
   - `SEED_OWNER_TENANT_ID`
   - `SEED_OWNER_EMAIL`
   - `SEED_OWNER_PASSWORD`
   - `SEED_OWNER_ROLE` (`ADMIN` / `USER`)
3. Run:
   - `npm run seed:owner`

## Firestore to Postgres Migration

This migrates current Firestore tenant data into this backend schema:

- cards -> `Card`
- cardStatements / latestBills -> `Statement`
- dailyCardExpenses -> `Transaction`
- pft_config/settings -> `PftSetting`

Required envs:

- `MIGRATION_FIRESTORE_UID`
- `MIGRATION_ACTOR_ID` (optional; default `migration-script`)
- `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_PROJECT_ID` (optional)

Dry-run (analysis only):

- `npm run migrate:firestore -- --dry-run`

Execute migration:

- `npm run migrate:firestore`

## Architecture

- `src/modules/*`: domain modules (cards, statements, transactions, auth, users, health)
- `src/shared/*`: shared abstractions (base entity, errors, guards, response helpers)
- `src/infrastructure/*`: persistence adapters (Prisma repositories, Prisma module)
- `prisma/*`: DB schema and migrations

See:

- `docs/api/openapi.md`
- `docs/domain/cards-statements-transactions.md`
- `docs/adr/ADR-001-modular-monolith-nestjs.md`
- `docs/adr/ADR-002-repository-abstraction-postgres-default.md`
- `docs/adr/ADR-003-dto-validation-openapi-zod.md`
