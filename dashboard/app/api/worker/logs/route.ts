import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";

export const runtime = "nodejs";

async function tail(file: string, lines = 120): Promise<string> {
  try {
    const entries = (await fs.readFile(file, "utf8")).split(/\r?\n/).filter(Boolean);
    return entries.slice(-lines).reverse().join("\n");
  }
  catch { return `[not found] ${file}`; }
}

export async function GET() {
  const logDir = path.join(config.repoRoot, "data", "logs");
  const body = [
    `Social Scheduler worker diagnostics — ${new Date().toISOString()}`,
    `Log directory: ${logDir}`,
    "",
    "=== worker.log (tail) ===",
    await tail(path.join(logDir, "worker.log")),
    "",
    "=== worker-daemon.out (tail) ===",
    await tail(path.join(logDir, "worker-daemon.out")),
    "",
    "=== worker-daemon.err (tail) ===",
    await tail(path.join(logDir, "worker-daemon.err")),
    "",
    "=== worker-autostart.out (tail) ===",
    await tail(path.join(logDir, "worker-autostart.out")),
  ].join("\n");
  return new NextResponse(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
