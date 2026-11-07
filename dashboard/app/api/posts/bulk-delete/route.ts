import { NextRequest, NextResponse } from "next/server";
import { deletePost, getPost } from "@/lib/queries";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body.post_ids) ? [...new Set(body.post_ids.map(Number))] : [];
  if (!ids.length || ids.some((id) => !Number.isInteger(id))) return NextResponse.json({ error: "Select at least one post." }, { status: 400 });
  for (const id of ids) {
    const post = getPost(id);
    if (!post) return NextResponse.json({ error: `Post ${id} was not found.` }, { status: 404 });
  }
  for (const id of ids) {
    const result = deletePost(id);
    if (result === "has_live") return NextResponse.json({ error: `Post ${id} has a live send and could not be deleted.` }, { status: 409 });
  }
  return NextResponse.json({ deleted: ids.length });
}
