import { NextRequest, NextResponse } from "next/server";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type GlobalWithRateLimit = typeof globalThis & {
  __kiezRateLimitBuckets?: Map<string, RateLimitBucket>;
};

const globalRateLimitState = globalThis as GlobalWithRateLimit;
const rateLimitBuckets = globalRateLimitState.__kiezRateLimitBuckets ?? new Map<string, RateLimitBucket>();
if (!globalRateLimitState.__kiezRateLimitBuckets) {
  globalRateLimitState.__kiezRateLimitBuckets = rateLimitBuckets;
}

const ADMIN_LIMIT = { max: 120, windowMs: 60_000 };
const ANALYTICS_LIMIT = { max: 240, windowMs: 60_000 };

function getClientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor
      .split(",")
      .map((entry) => entry.trim())
      .find(Boolean);
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) {
    return realIp.trim();
  }

  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp?.trim()) {
    return cfIp.trim();
  }

  return "unknown";
}

function pruneExpiredBuckets(now: number) {
  if (rateLimitBuckets.size < 2048) {
    return;
  }

  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function consumeToken(args: { key: string; max: number; windowMs: number }) {
  const now = Date.now();
  pruneExpiredBuckets(now);

  const current = rateLimitBuckets.get(args.key);
  if (!current || current.resetAt <= now) {
    const next: RateLimitBucket = {
      count: 1,
      resetAt: now + args.windowMs
    };
    rateLimitBuckets.set(args.key, next);
    return {
      allowed: true,
      remaining: args.max - 1,
      retryAfterSeconds: Math.ceil(args.windowMs / 1000)
    };
  }

  if (current.count >= args.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    };
  }

  current.count += 1;
  rateLimitBuckets.set(args.key, current);

  return {
    allowed: true,
    remaining: Math.max(0, args.max - current.count),
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  };
}

function buildLimitExceededResponse(retryAfterSeconds: number) {
  return NextResponse.json(
    {
      error: "Too many requests. Please try again shortly."
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "Cache-Control": "no-store"
      }
    }
  );
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (!pathname.startsWith("/api/admin") && !pathname.startsWith("/api/analytics")) {
    return NextResponse.next();
  }

  const clientIp = getClientIp(request);

  if (pathname.startsWith("/api/admin")) {
    const result = consumeToken({
      key: `admin:${clientIp}`,
      max: ADMIN_LIMIT.max,
      windowMs: ADMIN_LIMIT.windowMs
    });

    if (!result.allowed) {
      return buildLimitExceededResponse(result.retryAfterSeconds);
    }

    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Limit", String(ADMIN_LIMIT.max));
    response.headers.set("X-RateLimit-Remaining", String(result.remaining));
    return response;
  }

  const result = consumeToken({
    key: `analytics:${clientIp}`,
    max: ANALYTICS_LIMIT.max,
    windowMs: ANALYTICS_LIMIT.windowMs
  });

  if (!result.allowed) {
    return buildLimitExceededResponse(result.retryAfterSeconds);
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Limit", String(ANALYTICS_LIMIT.max));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  return response;
}

export const config = {
  matcher: ["/api/:path*"]
};
