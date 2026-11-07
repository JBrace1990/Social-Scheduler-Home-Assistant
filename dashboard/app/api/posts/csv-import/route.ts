import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { createDraftPost, createPostWithPublications, getChannel, getChannels, getPeriod, listTags } from "@/lib/queries";
import { feedTargets } from "@/lib/story-fanout";
import { parsePeriodLinks, parseTagIds } from "@/lib/content-model-validation";
import type { ContentKind, ContentStatus, PeriodMode } from "@/lib/types";
import { zonedTimeToUtc } from "@/lib/time";

export const runtime = "nodejs";

function csv(text: string): Record<string, string>[] {
  const out: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = !q;
    else if (c === "," && !q) { row.push(cell); cell = ""; } else if ((c === "\n" || c === "\r") && !q) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  const headers = (out.shift() ?? []).map((h) => h.trim().toLowerCase());
  return out.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export async function POST(req: NextRequest) {
  const rows = csv(await req.text());
  if (!rows.length) return NextResponse.json({ error: "CSV must contain at least one data row." }, { status: 400 });
  if (!rows.every((r) => r.path_url && r.caption !== undefined)) return NextResponse.json({ error: "Every row needs path_url and caption." }, { status: 400 });
  const created: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawPath = r.path_url.replace(/^\/(?:[A-Za-z]):\//, (m) => m.slice(1).replaceAll("/", "\\"));
    const localPath = path.normalize(rawPath);
    let bytes: Buffer;
    try { bytes = await fs.readFile(localPath); } catch { return NextResponse.json({ error: `Row ${i + 2}: local image was not found at ${localPath}.` }, { status: 422 }); }
    const filename = path.basename(localPath) || `csv-${i}.jpg`;
    const mime = filename.toLowerCase().endsWith(".png") ? "image/png" : filename.toLowerCase().endsWith(".webp") ? "image/webp" : "image/jpeg";
    const form = new FormData(); form.append("file", new File([bytes], filename, { type: mime }));
    const uploaded = await fetch(new URL("/api/assets/upload", req.url), { method: "POST", body: form });
    const body = await uploaded.json().catch(() => ({}));
    if (!uploaded.ok) return NextResponse.json({ error: `Row ${i + 2}: ${body.error ?? "image upload failed"}` }, { status: uploaded.status });
    const configuredTargets = (r.target_channel_ids || "").split("|").filter(Boolean).map(Number);
    const channelIds = configuredTargets.length ? configuredTargets : getChannels().slice(0, 1).map((channel) => channel.id);
    if (channelIds.some((id) => !Number.isInteger(id) || !getChannel(id))) return NextResponse.json({ error: `Row ${i + 2}: invalid target_channel_ids.` }, { status: 400 });
    const tagValues = (r.tag_ids || "").split("|").filter(Boolean);
    const periodValues = (r.period_links || "").split("|").filter(Boolean);
    const tagIds = parseTagIds(tagValues.map(Number), (id) => listTags().some((t) => t.id === id));
    const periods = parsePeriodLinks(periodValues.map((v) => { const [periodId, mode] = v.split(":"); return { periodId: Number(periodId), mode: mode as PeriodMode }; }), getPeriod);
    if (tagIds === "invalid" || periods === "invalid") return NextResponse.json({ error: `Row ${i + 2}: invalid tags or periods.` }, { status: 400 });
    const targets = feedTargets(channelIds);
    const variants = r.caption_variant ? [{ platform: null, body: r.caption, sort_order: 0 }, { platform: "facebook", body: r.caption_variant, sort_order: 1 }] : undefined;
    const contentKind = (r.content_kind.toLowerCase() === "one_time" ? "one_time" : "evergreen") as ContentKind;
    if (r.content_status === "ready" && r.scheduled_local && channelIds.length) {
      let scheduledAt: string;
      const localDateTime = r.scheduled_local.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)?.[0];
      if (!localDateTime) return NextResponse.json({ error: `Row ${i + 2}: scheduled_local must be YYYY-MM-DDTHH:MM or ISO datetime.` }, { status: 400 });
      try { scheduledAt = zonedTimeToUtc(localDateTime, r.timezone || "UTC"); } catch { return NextResponse.json({ error: `Row ${i + 2}: invalid scheduled_local or timezone.` }, { status: 400 }); }
      const isPast = Date.parse(scheduledAt) <= Date.now();
      const result = createPostWithPublications({ caption: r.caption, first_comment: r.first_comment || "", post_type: "single", asset_ids: [body.asset.id], targets, scheduled_at: isPast ? new Date().toISOString() : scheduledAt, content_kind: contentKind, content_status: "ready", skip_approval: isPast, tag_ids: tagIds ?? undefined, period_links: periods ?? undefined, caption_variants: variants });
      created.push(result.postId);
    } else {
      created.push(createDraftPost({ caption: r.caption, first_comment: r.first_comment || "", asset_ids: [body.asset.id], targets, content_kind: contentKind, content_status: (r.content_status === "ready" ? "ready" : "draft") as ContentStatus, tag_ids: tagIds ?? undefined, period_links: periods ?? undefined, caption_variants: variants }));
    }
  }
  return NextResponse.json({ uploaded: rows.length, created: created.length }, { status: 201 });
}
