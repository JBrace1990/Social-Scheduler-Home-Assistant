"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { Asset, Channel, ContentKind, ContentStatus, Period, PeriodMode, Tag } from "@/lib/types";
import type { ConformMode } from "@/lib/conform";
import { TagEditor } from "./tag-editor";
import { PeriodAttach } from "./period-attach";
import { FramingButton } from "./framing-button";
import { channelColor, videoPreviewSrc } from "@/lib/format";
import { ChannelAvatar } from "@/components/ui";

const CSV_HEADERS = ["path_url", "caption", "caption_variant", "first_comment", "schedule_text", "scheduled_local", "timezone", "content_kind", "content_status", "target_channel_ids", "tag_ids", "period_links"];
const CSV_SAMPLE = CSV_HEADERS.join(",");
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) { const ch = text[i];
    if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// `uid` is a per-tile client id: two tiles can share an assetId (re-importing a
// deduped image), so React keys must not be the assetId.
type Item = {
  uid: string;
  assetId: number;
  name: string;
  caption: string;
  deduped: boolean;
  // The whole asset, so the framing dialog can read dimensions and story fields.
  // The upload response already returns it; keeping loose copies of three of its
  // fields only invited them to drift.
  asset: Asset;
  mediaKind: "image" | "video";
  coverFrameMs: number | null;
};

const card = "rounded-card border border-border bg-surface p-5";
const segBtn = (active: boolean) =>
  `rounded-md px-3 py-1.5 text-sm transition-colors ${
    active ? "bg-brand-weak font-medium text-brand-strong" : "text-muted hover:text-ink"
  }`;

export function BulkImport({
  channels,
  periods,
  timeOfDayTags,
  topicTags,
}: {
  channels: Channel[];
  periods: Period[];
  timeOfDayTags: Tag[];
  topicTags: Tag[];
}) {
  const [items, setItems] = useState<Item[]>([]);
  const uidRef = useRef(0);
  const [uploading, setUploading] = useState(false);
  const [targets, setTargets] = useState<Set<number>>(() => channels.length === 1 ? new Set([channels[0].id]) : new Set());
  const [kind, setKind] = useState<ContentKind>("evergreen");
  const [status, setStatus] = useState<ContentStatus>("draft");
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [periodModes, setPeriodModes] = useState<Record<number, PeriodMode>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [csvMode, setCsvMode] = useState(false);
  async function downloadSample() { const res = await fetch("/api/posts/csv-template"); const csv = res.ok ? await res.text() : CSV_SAMPLE; const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const a = document.createElement("a"); a.href = url; a.download = "many-worlds-30-day-social-calendar.csv"; a.click(); URL.revokeObjectURL(url); }
  async function onCsv(file: File | undefined) {
    if (!file) return;
    try { const rows = parseCsv(await file.text()); if (!rows.length) throw new Error("The CSV has no data rows."); if (!("path_url" in rows[0]) || !("caption" in rows[0])) throw new Error("CSV headers must include path_url and caption.");
      setCsvMode(true); setUploading(true); setNotice("Uploading images and creating posts…");
      const res = await fetch("/api/posts/csv-import", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await file.text() });
      const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(body.error ?? "Could not import the CSV.");
      setResult(body.created); setItems([]); setNotice(`Uploaded ${body.uploaded} image${body.uploaded === 1 ? "" : "s"} and created ${body.created} post${body.created === 1 ? "" : "s"}.`); setError(null);
      setUploading(false); return;
    } catch (e) { setUploading(false); setCsvMode(false); setError(e instanceof Error ? e.message : "Could not read the CSV."); }
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setNotice(null);
    setResult(null);
    setUploading(true);
    let dedup = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/assets/upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Couldn't upload ${file.name}.`);
        continue;
      }
      if (body.deduped) dedup += 1;
      const uid = `${body.asset.id}-${uidRef.current++}`;
      setItems((prev) => [
        ...prev,
        {
          uid,
          assetId: body.asset.id,
          name: file.name,
          caption: "",
          deduped: body.deduped,
          asset: body.asset,
          mediaKind: body.asset.media_kind,
          // Already on the upload response — a fresh upload's is always null, but a
          // deduped re-upload of a video that already has a chosen cover reuses it, so
          // the preview shows the actual cover instead of frame 0.
          coverFrameMs: body.asset.cover_frame_ms ?? null,
        },
      ]);
    }
    if (dedup > 0) setNotice(`${dedup} image(s) already existed (matched by content) — reused.`);
    setUploading(false);
  }

  const setCaption = (i: number, caption: string) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, caption } : it)));
  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const toggleTarget = (id: number) =>
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function create() {
    setError(null);
    setResult(null);
    setCreating(true);
    const res = await fetch("/api/posts/bulk-import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((it) => ({ asset_id: it.assetId, caption: it.caption, first_comment: (it as Item & { firstComment?: string }).firstComment ?? "" })),
        target_channel_ids: Array.from(targets),
        content_kind: kind,
        content_status: status,
        tag_ids: tagIds,
        period_links: Object.entries(periodModes).map(([pid, mode]) => ({
          periodId: Number(pid),
          mode,
        })),
      }),
    });
    setCreating(false);
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "Could not create drafts.");
      return;
    }
    const b = await res.json();
    setResult(b.created);
    setItems([]);
  }

  return (
    <div className="space-y-6">
      {/* Upload */}
      <section className={card}>
        <div className="mb-4 rounded-lg border border-border bg-surface-sunken p-4"><p className="text-xs font-semibold uppercase tracking-wide text-muted">BULK IMPORT WITH CSV</p><label className="mt-2 inline-flex cursor-pointer items-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-ink">{uploading ? "Uploading and creating…" : "Choose CSV file"}<input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onCsv(e.target.files?.[0])} /></label><button type="button" onClick={downloadSample} className="ml-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface">Download CSV template</button><p className="mt-2 text-xs text-muted">Each row uploads its image from a local Windows <code>path_url</code> such as <code>C:\Users\…\Brew-Buddies.png</code>, then immediately creates the complete post.</p></div>
        {!csvMode ? <><div className="mb-3 text-center text-xs font-semibold uppercase tracking-wide text-faint">OR</div><h3 className="mb-2 font-display text-sm font-semibold text-ink">Traditional process</h3>
        <div>
        <label className="inline-flex cursor-pointer items-center rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-ink">
          {uploading ? "Uploading…" : "Add images"}
          <input
            type="file"
            multiple
            accept="image/*,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </label> <button type="button" onClick={downloadSample} className="ml-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-ink hover:bg-surface-sunken">Download CSV template</button></div>
        <p className="mt-2 text-xs text-muted">
          Add images to create posts with shared defaults, or import a CSV for per-post information. CSVs reference existing Media asset IDs.
        </p></> : null}
        {notice ? <p className="mt-2 text-xs text-status-posted">{notice}</p> : null}
      </section>

      {/* Grid of selected images */}
      {items.length > 0 ? (
        <section className={card}>
          <h3 className="mb-3 font-display text-sm font-semibold text-ink">
            {items.length} image{items.length === 1 ? "" : "s"} — add captions (optional)
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {items.map((it, i) => (
              <div key={it.uid} className="flex gap-3">
                <div className="shrink-0">
                  {it.mediaKind === "video" ? (
                    // No thumbnail file exists for video (no ffmpeg dependency by
                    // design) — render the real file with preload="metadata" so the
                    // browser decodes just the first frame, same approach as
                    // post-editor.tsx / cover-frame-picker.tsx. videoPreviewSrc's #t=
                    // fragment is what makes that frame actually paint in Safari.
                    <video
                      src={videoPreviewSrc(it.assetId, it.coverFrameMs)}
                      preload="metadata"
                      muted
                      playsInline
                      className="h-20 w-20 rounded-lg object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/media/${it.assetId}?variant=thumb`}
                      alt=""
                      className="h-20 w-20 rounded-lg object-cover"
                    />
                  )}
                  {/* Unconditional: gating on needsReview hid the control once a choice
                      was made. A just-imported image has no sends, so the count is 0. */}
                  {it.asset ? <FramingButton asset={it.asset} /> : null}
                </div>
                <div className="flex-1">
                  <textarea
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-brand"
                    rows={2}
                    placeholder="Caption (optional)…"
                    value={it.caption}
                    onChange={(e) => setCaption(i, e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeItem(i)}
                    className="mt-1 text-xs text-muted hover:text-status-failed"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Batch defaults */}
      {!csvMode ? <section className={card}>
        <h3 className="mb-1 font-display text-sm font-semibold text-ink">Batch defaults</h3>
        <p className="mb-3 text-xs text-muted">Applied to every image in this batch. Refine each later in the Library.</p>

        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-ink-soft">Target accounts</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {channels.map((c) => {
              const on = targets.has(c.id);
              const color = channelColor(c.id, c.color_hue);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleTarget(c.id)}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    on ? "border-transparent" : "border-border hover:bg-surface-sunken"
                  }`}
                  style={
                    on ? { backgroundColor: color.bg, boxShadow: `inset 0 0 0 2px ${color.dot}` } : undefined
                  }
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: on ? color.dot : "transparent",
                      border: on ? "none" : "1.5px solid var(--color-border-strong)",
                    }}
                    aria-hidden
                  />
                  <ChannelAvatar
                    id={c.id}
                    name={c.account_name}
                    colorHue={c.color_hue}
                    avatarPath={c.avatar_path}
                    size={20}
                  />
                  <span className="text-sm text-ink">{c.account_name}</span>
                  <span className="ml-auto text-xs text-muted">{c.platform}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-ink-soft">Kind</p>
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <button type="button" className={segBtn(kind === "evergreen")} onClick={() => setKind("evergreen")}>Evergreen</button>
            <button type="button" className={segBtn(kind === "one_time")} onClick={() => setKind("one_time")}>One-time</button>
          </div>
        </div>

        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-ink-soft">Status</p>
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <button type="button" className={segBtn(status === "draft")} onClick={() => setStatus("draft")}>Draft</button>
            <button type="button" className={segBtn(status === "ready")} onClick={() => setStatus("ready")}>Ready</button>
          </div>
          <p className="mt-1 text-xs text-faint">Ready content is eligible for auto-fill; drafts are not.</p>
        </div>

        <div className="mb-4">
          <p className="mb-2 text-xs font-medium text-ink-soft">Tags</p>
          <TagEditor timeOfDayTags={timeOfDayTags} topicTags={topicTags} value={tagIds} onChange={setTagIds} />
        </div>

        <PeriodAttach periods={periods} value={periodModes} onChange={setPeriodModes} />
      </section> : null}

      {!csvMode && error ? <p className="text-sm text-status-failed">{error}</p> : error ? <p className="text-sm text-status-failed">{error}</p> : null}
      {result !== null ? (
        <p className="text-sm text-status-posted">
          Created {result} draft{result === 1 ? "" : "s"}.{" "}
          <Link href="/library" className="underline underline-offset-2">View in Library →</Link>
        </p>
      ) : null}

      {!csvMode ? <div className="flex justify-end">
        <button
          onClick={create}
          disabled={creating || uploading || items.length === 0}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-ink disabled:opacity-50"
        >
          {creating ? "Creating…" : `Create ${items.length} draft${items.length === 1 ? "" : "s"}`}
        </button>
      </div> : null}
    </div>
  );
}
