"use client";

import { useState } from "react";

export default function HomeAssistantMigrationPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setStatus("Uploading archive to Home Assistant… keep this page open.");
    try {
      const parts = window.location.pathname.split("/");
      const base = parts.slice(0, 4).join("/");
      const response = await fetch(`${base}/api/admin/migrate`, {
        method: "POST",
        headers: { "Content-Type": "application/x-tar" },
        body: file,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Upload failed (${response.status}).`);
      setStatus(`${result.message} Uploaded ${(result.bytes / 1024 / 1024).toFixed(1)} MB. Stop and start Social Scheduler to finish importing.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-8 text-ink">
      <h1 className="text-2xl font-semibold">Import local Social Scheduler data</h1>
      <p>Select the migration archive created from your Windows installation. It contains the database, media, and app settings and is sent directly to this Home Assistant app through its authenticated ingress.</p>
      <input
        type="file"
        accept=".tar,application/x-tar"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        disabled={busy}
        className="block w-full rounded border border-line bg-white p-3"
      />
      <button
        type="button"
        onClick={upload}
        disabled={!file || busy}
        className="rounded bg-brand px-4 py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? "Uploading…" : "Upload and stage import"}
      </button>
      {status && <p role="status" className="break-words rounded border border-line bg-white p-4">{status}</p>}
    </main>
  );
}
