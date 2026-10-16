/**
 * A rate limiter in memory, for a single process (a small API, a Raspberry Pi). It uses a sliding window counter: the
 * previous window counts in proportion to how much of it still overlaps, which is accurate enough and needs two numbers
 * per key. Memory is capped (`maxKeys`): when it is full the oldest idle keys are dropped, never the busy ones.
 * For several servers use a shared store (Redis); this one does not talk to other processes.
 */
export function createLimiter({ limit, windowMs, maxKeys = 10_000, now = Date.now } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError("createLimiter: limit must be a whole number of at least 1");
  if (!Number.isFinite(windowMs) || windowMs < 1) throw new RangeError("createLimiter: windowMs must be a positive number");
  if (!Number.isInteger(maxKeys) || maxKeys < 1) throw new RangeError("createLimiter: maxKeys must be a whole number of at least 1");
  const keys = new Map(); // key -> { window, count, previous }

  function slide(entry, current) {
    if (entry.window === current) return;
    entry.previous = entry.window === current - 1 ? entry.count : 0;
    entry.count = 0;
    entry.window = current;
  }

  function evict(current) {
    for (const [key, entry] of keys) {
      if (entry.window < current - 1) keys.delete(key);
    }
    while (keys.size >= maxKeys) keys.delete(keys.keys().next().value);
  }

  /** The earliest moment (in ms from now) at which a request of this cost fits, if nothing else arrives. */
  function retryAfter(entry, into, cost) {
    const room = limit - cost; // what may already be used
    if (room < 0) return 2 * windowMs; // a single request bigger than the limit never fits
    if (entry.previous > 0 && entry.count <= room) {
      const x = Math.max(into, 1 - (room - entry.count) / entry.previous);
      if (x < 1) return Math.ceil((x - into) * windowMs) + 1;
    }
    const next = entry.count > 0 ? Math.max(0, 1 - room / entry.count) : 0;
    return Math.ceil((1 - into + next) * windowMs) + 1;
  }

  return {
    /** Counts one request for `key` unless it is over the limit. */
    check(key, cost = 1) {
      const time = now();
      const current = Math.floor(time / windowMs);
      let entry = keys.get(String(key));
      if (!entry) {
        if (keys.size >= maxKeys) evict(current);
        entry = { window: current, count: 0, previous: 0 };
        keys.set(String(key), entry);
      } else {
        keys.delete(String(key)); // keep the most recently used keys at the end
        keys.set(String(key), entry);
      }
      slide(entry, current);
      const into = (time % windowMs) / windowMs;
      const used = entry.previous * (1 - into) + entry.count;
      const allowed = used + cost <= limit;
      if (allowed) entry.count += cost;
      const remaining = Math.max(0, Math.floor(limit - (used + (allowed ? cost : 0))));
      const retryMs = allowed ? 0 : retryAfter(entry, into, cost);
      return { allowed, limit, remaining, retryAfterMs: retryMs, retryAfterSeconds: Math.ceil(retryMs / 1000) };
    },
    /** Forget a key (for example after a successful login). */
    reset(key) {
      keys.delete(String(key));
    },
    get size() {
      return keys.size;
    }
  };
}

/**
 * Middleware for `node:http` and Express. `key(req)` decides who is who (default: the connection's address; behind a proxy
 * pass `key` that reads a header you trust). Answers 429 with `Retry-After` and the RateLimit headers.
 */
export function rateLimit({ key = (req) => req.socket?.remoteAddress ?? "unknown", message = "Too many requests", ...options } = {}) {
  const limiter = createLimiter(options);
  return (req, res, next) => {
    const result = limiter.check(key(req));
    res.setHeader("RateLimit-Limit", String(result.limit));
    res.setHeader("RateLimit-Remaining", String(result.remaining));
    if (result.allowed) return next?.();
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: message, retryAfterSeconds: result.retryAfterSeconds }));
  };
}
