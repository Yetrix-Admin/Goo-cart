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
npm run seed:reset      # drop the MONGODB_DB database first, then seed
```

`seed:reset` drops **only** the database named by `MONGODB_DB`. Other
databases on the same cluster are listed and left alone — this cluster is
shared with other projects, and dropping a neighbouring database would destroy
a live system with no way back on the free tier.

The plain `seed` is idempotent: it upserts by `slug`/`code`, so running it
twice does not duplicate anything.

Seeds 10 restaurants, 19 menu items (with variants and add-ons embedded),
3 coupons, 10 roles and 6 service configs.

## Migrating existing D1 data

From the repository root, run the migration against the local Miniflare D1
file. It reads Atlas credentials from `server/.env`, upserts without dropping
or deleting anything, and can be safely repeated:

```bash
python scripts/migrate-d1-to-mongodb.py <path-to-d1.sqlite> --dry-run
python scripts/migrate-d1-to-mongodb.py <path-to-d1.sqlite>
```

Users, sessions, catalog data, food orders, service orders, portal data,
settings, permissions, and audit history are all mapped into the collections
used by this API. Former SQL child tables are embedded in their parent
documents. Migrated PBKDF2 passwords continue to work and are upgraded to
bcrypt after the customer's next successful login.

## Running

```bash
npm run dev             # tsx watch, reloads on change
npm run build && npm start
npm run typecheck
```

Health check — reports whether Mongo is genuinely reachable:

```bash
curl http://localhost:3001/health
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

- No payment gateway. `paymentStatus` is set optimistically on order creation;
  the app still shows clearly-labelled demo payment buttons.
- **Email OTP** is delivered through Resend when `RESEND_API_KEY` and
  `RESEND_FROM_EMAIL` are set; the sending domain must be verified in Resend
  or the send is rejected. **SMS OTP has no provider** — phone codes are
  logged. In both fallback cases the API reports `delivered: false` rather
  than claiming a code was sent.
