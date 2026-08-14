import type { NextConfig } from "next";

/**
 * Content-Security-Policy. Moderate, not nonce-strict: Next.js App Router injects inline hydration
 * scripts and inline critical CSS, so a fully strict policy would need per-request nonces via
 * middleware. For this prototype we lock down the high-value directives — no framing, no plugins,
 * no external script/connect/font origins — and accept 'unsafe-inline' for script/style. Residual
 * XSS risk is low here because React escapes all transcribed label text by default (it is never
 * rendered as HTML). A production build would move to nonce-based script-src.
 */
// `next dev` uses eval() for React's dev-only debugging tooling, so allow 'unsafe-eval' in
// development. Production never uses eval, so the shipped policy stays strict.
const scriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  scriptSrc,
  "connect-src 'self'",
  "font-src 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
