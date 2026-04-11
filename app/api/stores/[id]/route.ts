import { NextResponse } from "next/server";
import { getStoreDetail } from "@/lib/data";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const detail = await getStoreDetail(id);

  if (!detail) {
    return NextResponse.json({ error: "Store not found." }, { status: 404 });
  }

  return NextResponse.json(detail);
}
