import type { NextConfig } from "next";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // `next dev` (React Refresh) needs eval; production keeps the strict policy.
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'"
].join("; ");

const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: CONTENT_SECURITY_POLICY
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload"
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "X-Frame-Options",
    value: "DENY"
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()"
  }
];

const nextConfig: NextConfig = {
  typedRoutes: true,
  outputFileTracingRoot: process.cwd(),
  // The presence engine falls back to the committed OSM snapshots when Supabase is not available.
  outputFileTracingIncludes: {
    "/api/search": ["./data/berlin/osm_*_establishments.normalized.json"],
    "/api/presence/**": ["./data/berlin/osm_*_establishments.normalized.json"],
    "/api/admin/presence/**": ["./data/berlin/osm_*_establishments.normalized.json"],
    "/[locale]/store/[id]": ["./data/berlin/osm_*_establishments.normalized.json"]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS
      }
    ];
  }
};

export default nextConfig;
