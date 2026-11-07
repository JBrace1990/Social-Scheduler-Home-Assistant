import { NextRequest, NextResponse } from "next/server";
import { deleteAsset, getAsset } from "@/lib/queries";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.asset_ids)
    ? [...new Set((body.asset_ids as unknown[]).map((value) => Number(value)))]
    : [];
  if (!ids.length || ids.some((id) => !Number.isInteger(id))) return NextResponse.json({ error: "Select at least one media item." }, { status: 400 });
  const blocked: number[] = [];
  let deleted = 0;
  for (const id of ids) {
    if (!getAsset(id)) { blocked.push(id); continue; }
    if (deleteAsset(id) === "ok") deleted++;
    else blocked.push(id);
  }
  return NextResponse.json({ deleted, blocked }, { status: blocked.length ? 409 : 200 });
}
