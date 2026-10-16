import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { test } from "node:test";

import { createLimiter, rateLimit } from "./src/index.js";

test("allows the limit, then refuses", () => {
  let t = 0;
  const l = createLimiter({ limit: 3, windowMs: 1000, now: () => t });
  assert.deepEqual([1, 2, 3].map(() => l.check("a").allowed), [true, true, true]);
  const refused = l.check("a");
  assert.equal(refused.allowed, false);
  assert.equal(refused.remaining, 0);
  assert.ok(refused.retryAfterSeconds >= 1);
  assert.equal(l.check("b").allowed, true);
});

test("remaining counts down", () => {
  const l = createLimiter({ limit: 3, windowMs: 1000, now: () => 0 });
  assert.deepEqual([l.check("a").remaining, l.check("a").remaining, l.check("a").remaining], [2, 1, 0]);
});

test("the window slides: the previous window still counts, in proportion", () => {
  let t = 0;
  const l = createLimiter({ limit: 10, windowMs: 1000, now: () => t });
  for (let i = 0; i < 10; i++) l.check("a");
  t = 1500; // halfway into the next window: half of the 10 still counts
  const first = l.check("a");
  assert.equal(first.allowed, true);
  let more = 0;
  while (l.check("a").allowed) more++;
  assert.ok(more >= 3 && more <= 5, `got ${more}`);
  t = 3000; // two windows later: all clear
  assert.equal(l.check("a").remaining, 9);
});

test("retry-after is honest: waiting that long lets the request through", () => {
  let t = 0;
  const l = createLimiter({ limit: 5, windowMs: 1000, now: () => t });
  for (let i = 0; i < 5; i++) l.check("a");
  const refused = l.check("a");
  assert.equal(refused.allowed, false);
  t += refused.retryAfterMs;
  assert.equal(l.check("a").allowed, true);
});

test("cost, reset, and the memory cap", () => {
  const l = createLimiter({ limit: 5, windowMs: 1000, maxKeys: 3, now: () => 0 });
  assert.equal(l.check("a", 5).allowed, true);
  assert.equal(l.check("a").allowed, false);
  l.reset("a");
  assert.equal(l.check("a").allowed, true);
  for (const k of ["b", "c", "d", "e"]) l.check(k);
  assert.ok(l.size <= 3);
  assert.throws(() => createLimiter({ limit: 0, windowMs: 1 }), RangeError);
  assert.throws(() => createLimiter({ limit: 1, windowMs: 0 }), RangeError);
});

test("a flood of one key cannot push out a busy key that is still being used", () => {
  const l = createLimiter({ limit: 2, windowMs: 1000, maxKeys: 2, now: () => 0 });
  l.check("busy"); l.check("busy");
  l.check("x1"); l.check("busy"); l.check("x2"); l.check("busy");
  assert.equal(l.check("busy").allowed, false);
});

test("middleware answers 429 with headers", async () => {
  const handler = rateLimit({ limit: 2, windowMs: 60_000, key: () => "same" });
  const server = createServer((req, res) => handler(req, res, () => res.end("ok")));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const get = () => new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port: server.address().port, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject).end();
  });
  assert.equal((await get()).status, 200);
  assert.equal((await get()).headers["ratelimit-remaining"], "0");
  const blocked = await get();
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers["retry-after"]) >= 1);
  assert.equal(JSON.parse(blocked.body).error, "Too many requests");
  server.close();
});

test("retry-after is honest for many situations", () => {
  for (const [limit, windowMs, burst, start] of [[3, 1000, 7, 0], [10, 60_000, 25, 45_000], [1, 500, 3, 499], [5, 1000, 5, 1999], [100, 1000, 250, 700]]) {
    let t = start;
    const l = createLimiter({ limit, windowMs, now: () => t });
    for (let i = 0; i < burst; i++) l.check("k");
    t += 400; // some time passes, so the previous window has content
    for (let i = 0; i < burst; i++) l.check("k");
    const refused = l.check("k");
    if (refused.allowed) continue;
    t += refused.retryAfterMs;
    assert.equal(l.check("k").allowed, true, `limit ${limit}, window ${windowMs}`);
  }
});
