# Casino MMORPG — Architecture & Build Plan

A 2D top-down multiplayer casino (Habbo-style) on Solana. Server-authoritative
for movement, chat, and **all** game outcomes and balances.

## Stack

| Layer    | Tech |
|----------|------|
| Frontend | React + Vite, Phaser 3, TypeScript, Zustand, socket.io-client, @solana/wallet-adapter (Phantom) |
| Backend  | NestJS, TypeScript, socket.io, Prisma, PostgreSQL, Redis (ioredis + @socket.io/redis-adapter) |
| Chain    | Solana web3.js + SPL token; custom mint; hot bankroll wallet for payouts |
| Deploy   | Railway: separate Frontend + Backend services, managed PostgreSQL + Redis |

## Core security model (the whole point)

1. **Frontend is never trusted.** It sends *intents* ("place 100 on red",
   "move to tile x,y"), never results or balances.
2. **Identity = wallet signature.** Connect Phantom → backend issues nonce →
   user signs → backend verifies ed25519 sig against the pubkey → JWT (short)
   + refresh token (rotating, hashed in DB, server-revocable).
3. **Every socket connection is authenticated** with the JWT and re-checked on
   each privileged event. No JWT → no room joins, no bets.
4. **Money is a server ledger.** `User.balance` mutates only inside DB
   transactions written by backend after: (a) verifying an on-chain deposit, or
   (b) settling a bet from a server-generated outcome. Deposits are matched to
   the BANKROLL_WALLET by on-chain signature; each signature is unique
   (`Transaction.onchainSig @unique`) → replay-proof.
5. **Outcomes are provably fair.** Per round: server generates `serverSeed`,
   publishes `sha256(serverSeed)` *before* bets, derives the result from
   `HMAC(serverSeed, clientSeed:nonce)`, reveals `serverSeed` after settle.
   Stored in `FairnessRound`; players can recompute.
6. **Anti-cheat movement.** Server holds canonical positions, validates max
   speed / reachability per tick, rejects teleports, broadcasts authoritative
   state. Click-to-move pathing validated server-side.
7. **Rate limits & replay protection** on every socket event and HTTP route
   (Redis token buckets); nonces and idempotency keys prevent replays.

## Payout safety

- `BANKROLL_PRIVATE_KEY` lives only in backend env (Railway secret). Never in
  the repo, never in the frontend, never logged.
- Payouts go through a **queue** with: idempotency key per bet, per-tx and
  per-window caps, on-chain confirmation tracking, and a retry/backoff with a
  dead-letter state (`Transaction.status = FAILED`) for manual review.
- Withdrawals debit the ledger *before* signing, and only confirm the tx after
  on-chain finalization; failures re-credit.

> Real-money launch requires an external audit of the settlement + payout path
> and the bankroll key custody before liquidity is added.

## Map / assets

Assets are RPG Maker MV format (`casinoluxury/`): Luxury Casino tilesets
(48px, A1/A2/A4/B/C) + sample maps (`examples/data/Map001-003.json`, Map001 is
60×20). A converter (`tools/mv2tiled`) translates MV map + tileset data into a
Phaser-consumable tilemap (JSON + atlas) so we render in Phaser, not the MV
runtime. Collision derived from MV tile flags.

## Build phases

- **Phase 1 (this branch): foundation** ✅
  Monorepo, full Prisma schema, wallet-auth spine (nonce/verify/JWT/refresh),
  Redis + socket auth guard, config, env templates, Dockerfiles, Railway
  config, deployment guide.
- **Phase 2: world** ✅ — `tools/build-map.mjs` derives a shared map descriptor
  (collision + interactable anchors) from the MV data; in-browser MV renderer
  (`frontend/src/lib/mvMap.ts`, A1–A4 autotiles) bakes the casino 1:1; socket
  world gateway with server-authoritative click-to-move (BFS pathing,
  anti-teleport/anti-speed), presence (enter/leave/idle) over a Redis-mirrored
  roster; Phaser client renders map + players + interpolation.
- **Phase 3: chat** ✅ — global + nearby scopes, bubbles above avatars, history,
  rate limit + 1s cooldown + length cap, swappable profanity filter.
- **Phase 4: Solana money** ✅ — central atomic ledger (single source of truth),
  on-chain deposit verification (amount read from chain, replay-proof via unique
  signature), payout queue + bankroll signer with per-tx/per-window caps, retry
  + dead-letter, withdrawal flow.
- **Phase 5: games** ✅ — provably-fair core (commit/reveal HMAC PRNG) + public
  verify route, then Roulette (8-seat rooms, shared wheel/countdown, leader-
  locked round loop), Blackjack (5-seat, dealer logic, seat turns + timers),
  Slots (single-player). All outcomes backend-authoritative.
- **Phase 6: QA + deploy** ✅ — unit tests for the fairness PRNG (determinism +
  uniformity) and the roulette/blackjack payout math (16 passing); both apps
  build clean (`tsc`/`nest build`/`vite build`); Railway config + Dockerfiles +
  deployment guide ready.

Each phase was reviewed (correctness + security pass) before being called done.

> ⚠️ Real-money launch still requires an external audit of the settlement +
> payout path and bankroll-key custody, plus a browser smoke test of the live
> map render and multi-client sync, before liquidity is added.
