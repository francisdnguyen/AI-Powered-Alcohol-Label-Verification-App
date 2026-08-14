/**
 * Per-IP rate limiting for the routes that spend Claude credits.
 *
 * In-memory sliding window. LIMITATION (prototype): per-instance, not distributed —
 * on Vercel each serverless instance keeps its own counters. A production build would
 * use a shared store (Vercel KV / Redis). Documented in SECURITY.md.
 */

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 20; // per IP per window

const hits = new Map<string, number[]>();

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec?: number;
}

export function checkRateLimit(ip: string): RateLimitResult {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_REQUESTS) {
    hits.set(ip, recent);
    const retryAfterSec = Math.max(
      1,
      Math.ceil((WINDOW_MS - (now - recent[0])) / 1000),
    );
    return { ok: false, retryAfterSec };
  }

  recent.push(now);
  hits.set(ip, recent);

  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (hits.size > 5000) {
    for (const [key, times] of hits) {
      if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }

  return { ok: true };
}

/**
 * Best-effort client IP from proxy headers. Prefer `x-real-ip`: on Vercel it is set by the
 * platform and is not client-forgeable. The leftmost `x-forwarded-for` entry is client-supplied
 * and can be spoofed to get a fresh rate-limit bucket per request, so it is only a fallback for
 * non-Vercel environments.
 */
export function getClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return "unknown";
}
