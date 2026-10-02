import { NextRequest, NextResponse } from "next/server";
import { DEVICE_COOKIE, recordPresenceFeedback } from "@/lib/presence/server";

type FeedbackPayload = {
  storeId?: unknown;
  productTypeId?: unknown;
  found?: unknown;
  interactionId?: unknown;
  query?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Crowd evidence: "I found / did not find <product type> at <store>".
 * Anonymous by design: a random httpOnly device cookie, stored only as a salted hash,
 * limits each device to one current vote per (store, type) and a daily cap.
 */
export async function POST(request: NextRequest) {
  let body: FeedbackPayload;
  try {
    body = (await request.json()) as FeedbackPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const storeId = typeof body.storeId === "string" ? body.storeId.trim() : "";
  const productTypeId = typeof body.productTypeId === "string" ? body.productTypeId.trim() : "";
  if (!storeId || storeId.length > 64 || !/^[a-z0-9_]{2,64}$/.test(productTypeId) || typeof body.found !== "boolean") {
    return NextResponse.json({ error: "storeId, productTypeId and found (boolean) are required." }, { status: 400 });
  }
  const interactionId =
    typeof body.interactionId === "string" && UUID_PATTERN.test(body.interactionId) ? body.interactionId : null;
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : null;

  const existingDevice = request.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existingDevice && UUID_PATTERN.test(existingDevice) ? existingDevice : crypto.randomUUID();

  const outcome = await recordPresenceFeedback({
    storeId,
    productTypeId,
    found: body.found,
    deviceId,
    interactionId,
    query
  });

  const response = outcome.ok
    ? NextResponse.json({
        ok: true,
        probability: Number(outcome.estimate.probability.toFixed(3)),
        tier: outcome.estimate.tier
      })
    : NextResponse.json({ error: outcome.error }, { status: outcome.status });

  if (deviceId !== existingDevice) {
    response.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365
    });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}
