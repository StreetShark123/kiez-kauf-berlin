import { NextResponse } from "next/server";

const ADMIN_INTERNAL_ERROR_MESSAGE = "Internal admin error.";

export function adminInternalError(error: unknown) {
  console.error("[admin-api] Internal error", error);
  return NextResponse.json({ error: ADMIN_INTERNAL_ERROR_MESSAGE }, { status: 500 });
}
