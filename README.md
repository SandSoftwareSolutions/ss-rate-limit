# @sandsoftwaresolutions/rate-limit

[![CI](https://github.com/SandSoftwareSolutions/ss-rate-limit/actions/workflows/ci.yml/badge.svg)](https://github.com/SandSoftwareSolutions/ss-rate-limit/actions/workflows/ci.yml)

Rate limiting in memory, for one process: a small API, a Raspberry Pi, a login form. A sliding window, a memory cap, and an honest `Retry-After`. No dependencies and no Redis. (For several servers use a shared store; this package does not talk to other processes.)

## Install

```bash
npm install @sandsoftwaresolutions/rate-limit
```

## Middleware (`node:http`, Express)

```js
import { rateLimit } from "@sandsoftwaresolutions/rate-limit";

const limit = rateLimit({ limit: 100, windowMs: 60_000 });
app.use(limit);                         // Express
// or: createServer((req, res) => limit(req, res, () => handle(req, res)))
```

Over the limit the response is `429` with `Retry-After`, `RateLimit-Limit` and `RateLimit-Remaining`.

**Who is who?** By default the key is the connection's IP address. Behind a proxy that is the proxy, so pass your own `key` and read only a header **you trust**:

```js
rateLimit({ limit: 5, windowMs: 60_000, key: (req) => req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress });
```

## Use it directly

```js
import { createLimiter } from "@sandsoftwaresolutions/rate-limit";

const logins = createLimiter({ limit: 5, windowMs: 15 * 60_000 });

const r = logins.check(`login:${email}`);
if (!r.allowed) throw new Error(`Try again in ${r.retryAfterSeconds} seconds`);
// ... after a successful login:
logins.reset(`login:${email}`);
```

`check(key, cost = 1)` returns `{ allowed, limit, remaining, retryAfterMs, retryAfterSeconds }`.

## How it counts

A *sliding window counter*: the previous window counts in proportion to how much of it still overlaps with the last `windowMs`. That avoids the burst of double the limit that a fixed window allows at a boundary, and needs only two numbers per key.

- `retryAfter` is computed, not guessed: if you wait that long, the request fits.
- `maxKeys` (default 10 000) caps memory. When it is full, keys that were not used recently are dropped first, so a flood of new keys cannot throw out a busy one.
- State is lost when the process restarts. For brute-force protection that is usually fine; for billing it is not.
