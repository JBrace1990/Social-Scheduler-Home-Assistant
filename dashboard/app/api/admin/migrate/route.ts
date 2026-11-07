import { NextRequest, NextResponse } from "next/server";
import { access, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const target = "/data/socialscheduler-migration.tar";
const maxBytes = 1_500_000_000;

export async function POST(req: NextRequest) {
  if (await access("/data/.migration-imported").then(() => true).catch(() => false)) {
    return NextResponse.json({ error: "A migration has already been imported." }, { status: 409 });
  }
  if (await stat(target).then(() => true).catch(() => false)) {
    return NextResponse.json({ error: "A migration archive is already staged." }, { status: 409 });
  }
  if (!req.body) return NextResponse.json({ error: "A tar archive body is required." }, { status: 400 });
  if (req.headers.get("content-type")?.split(";")[0] !== "application/x-tar") {
    return NextResponse.json({ error: "Content-Type must be application/x-tar." }, { status: 415 });
  }
  const temp = path.join("/share", `.socialscheduler-migration-${randomUUID()}.tmp`);
  let size = 0;
  try {
    const file = await open(temp, "wx", 0o600);
    try {
      const reader = req.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error("Archive exceeds 1.5 GB.");
        }
        await file.writeFile(value);
      }
      await file.sync();
    } finally {
      await file.close();
    }
    if (!size) throw new Error("Archive is empty.");
    const { rename } = await import("node:fs/promises");
    await rename(temp, target);
    return NextResponse.json({ staged: true, bytes: size, message: "Archive staged. Stop and start the app to import it." }, { status: 201 });
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    const message = error instanceof Error ? error.message : "Archive upload failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
