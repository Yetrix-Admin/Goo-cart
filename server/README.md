# Goocart API — Node + Express + MongoDB Atlas

Replaces the Cloudflare Workers + D1 backend. Serves the same `/api/v1/*`
contract the mobile app already calls, so the app needs no code changes.

## Why this exists

MongoDB cannot run well on Cloudflare Workers:

- The **Atlas Data API was shut down on 30 September 2025**, removing the HTTP
  interface Workers could have used.
- The MongoDB driver needs `net.Socket` / `tls.TLSSocket`, which Workers does
  not provide as a drop-in.

So the backend moved to a plain Node runtime, where the standard driver works.

## Setup

```bash
cd server
npm install
cp .env.example .env    # then fill in MONGODB_URI
```

`.env` is gitignored. **Never commit a connection string** — it contains the
database password.

### Atlas prerequisites

1. **Network Access → Add IP Address.** Add your current IP, or `0.0.0.0/0`
   for development. Without this every connection fails with a timeout.
2. **Database Access.** The user in the URI needs `readWrite` on the target
   database.

## Seeding

```bash
npm run seed            # upsert the catalog into MONGODB_DB (safe, repeatable)
npm run seed:reset      # DROPS EVERY DATABASE on the cluster first
```

`seed:reset` is destructive and irreversible. It drops every database except
Mongo's internal `admin`, `local` and `config` — including databases belonging
to other projects on the same cluster. The plain `seed` is idempotent: it
upserts by `slug`/`code`, so running it twice does not duplicate anything.

Seeds 10 restaurants, 19 menu items (with variants and add-ons embedded),
3 coupons, 10 roles and 6 service configs.

## Running

```bash
npm run dev             # tsx watch, reloads on change
npm run build && npm start
npm run typecheck
```

Health check — reports whether Mongo is genuinely reachable:

```bash
curl http://localhost:3000/health
```

## Endpoints

| Method | Path | Auth |
|---|---|---|
| POST | `/api/v1/auth/token` (`mode: signup\|login`) | — |
| POST | `/api/v1/auth/signup`, `/login`, `/logout` | — |
| POST | `/api/v1/auth/otp/request`, `/otp/verify` | — |
| GET | `/api/v1/auth/me` | Bearer |
| GET | `/api/v1/catalog/restaurants` | — |
| GET | `/api/v1/catalog/restaurants/:id` | — |
| GET | `/api/v1/catalog/search?q=` | — |
| GET | `/api/v1/catalog/coupons` | — |
| POST | `/api/v1/orders` | Bearer |
| GET | `/api/v1/orders`, `/orders/:id` | Bearer |
| POST | `/api/v1/orders/:id/transition` | Bearer |

Auth is a Bearer token (mobile) or the `goocart_session` cookie (web), both
resolving to the same `sessions` document.

## Schema shape

25 SQL tables became 12 collections. Relations that are always read with their
parent are **embedded** — a restaurant's `offers` and `categories`, a food
item's `variants` and `addonGroups`, an order's `items` and `statusHistory`.
Independently queried entities stay top-level: `users`, `sessions`, `otps`,
`restaurants`, `fooditems`, `orders`, `coupons`, `auditlogs`, `counters`.

`counters` backs gap-free order numbers via an atomic `$inc` — the Mongo
equivalent of `AUTOINCREMENT`.

## Guarantees carried over from D1

- **Orders are priced server-side.** Every line is re-priced from the database;
  client-sent prices are ignored, so a tampered request cannot underpay.
- **The state machine rejects invalid transitions.** `PLACED → DELIVERED` fails.
- **Delivery needs the customer's OTP**, and only the customer and the assigned
  partner can read it.
- **Claiming a job is race-safe** — the update is guarded on the prior status,
  so two partners cannot both claim one order.

## Not yet done

- The **web vendor/admin portal still reads D1**. Only the mobile `/api/v1`
  surface is on MongoDB.
- No payment gateway. `paymentStatus` is set optimistically on order creation.
- OTP codes are logged to the console; no SMS/email provider is wired.
