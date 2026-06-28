# Production Deployment Guide (Railway)

Four Railway services in one project: **backend**, **frontend**, **PostgreSQL**,
**Redis**.

## 0. Prereqs
- Railway account + project. (Token goes in your shell as `RAILWAY_TOKEN`, never
  in the repo.)
- An SPL token mint and a dedicated **bankroll wallet** (its secret key is the
  payout signer — keep minimal float, treat as a hot wallet).
- Strong JWT secrets: `openssl rand -base64 48` (one for access, one for refresh).

## 1. Provision data plugins
In the Railway project: **New → Database → PostgreSQL**, then again for **Redis**.
They expose `${{Postgres.DATABASE_URL}}` and `${{Redis.REDIS_URL}}`.

## 2. Backend service
- New service → Deploy from repo, **root directory = `backend/`**.
- Build uses `backend/Dockerfile` (via `railway.json`). Start command runs
  `prisma migrate deploy` then boots Nest.
- Variables (from `backend/.env.example`):
  - `DATABASE_URL=${{Postgres.DATABASE_URL}}`
  - `REDIS_URL=${{Redis.REDIS_URL}}`
  - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (the generated secrets)
  - `SOLANA_RPC_URL`, `TOKEN_MINT`, `BANKROLL_WALLET`, `BANKROLL_PRIVATE_KEY`
  - `CORS_ORIGINS=https://<frontend-domain>`
  - `PORT=3000`
- Generate a public domain (Settings → Networking). Healthcheck path `/health`.

## 3. Frontend service
- New service → same repo, **root directory = `frontend/`**, `frontend/Dockerfile`.
- Build-time variables (from `frontend/.env.example`):
  - `VITE_API_URL=https://<backend-domain>`
  - `VITE_SOCKET_URL=https://<backend-domain>`
  - `VITE_SOLANA_RPC_URL`, `VITE_TOKEN_MINT`, `VITE_BANKROLL_WALLET`
- Generate a public domain. Put that domain into the backend `CORS_ORIGINS`.

## 4. Migrations
`prisma migrate deploy` runs automatically on backend start. To create the
initial migration locally first:
```
cd backend
npm install
npx prisma migrate dev --name init   # generates prisma/migrations/*
git add prisma/migrations && git commit -m "init migration"
```
Commit the migration folder so production applies the exact same schema.

## 5. Smoke test
- `GET https://<backend>/health` → `{"status":"ok"}`
- `POST /auth/nonce` with a wallet → returns a message to sign.
- Open the frontend, connect Phantom, sign, confirm a JWT is issued.

## 6. Scaling notes
- Socket.io uses the Redis adapter, so the backend can run multiple replicas;
  rooms/presence stay consistent.
- Keep the bankroll float low; top up via ops. Monitor `Transaction` rows in
  `FAILED` state (dead-letter payouts) and the payout queue depth.

## Secret hygiene
- `.env*` is gitignored. Real secrets live only in Railway variables.
- Rotate `BANKROLL_PRIVATE_KEY` and JWT secrets if ever exposed (rotating JWT
  secrets invalidates all existing sessions — expected).
