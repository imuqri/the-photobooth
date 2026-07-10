// Minimal in-memory rate limiter, keyed by IP.
// Good enough for a single-instance server; swap for a Redis-backed
// limiter (e.g. rate-limiter-flexible) if you ever scale to multiple
// server instances behind a load balancer.

const buckets = new Map();

/**
 * @param {string} key - usually the client IP
 * @param {number} limit - max attempts allowed in the window
 * @param {number} windowMs - window size in ms
 * @returns {boolean} true if the request is allowed
 */
export function allow(key, limit, windowMs) {
  const now = Date.now();
  const bucket = buckets.get(key) ?? [];
  const recent = bucket.filter((t) => now - t < windowMs);
  recent.push(now);
  buckets.set(key, recent);
  return recent.length <= limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, times] of buckets) {
    if (times.every((t) => now - t > 5 * 60 * 1000)) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();
