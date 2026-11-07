"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { accountIdLabel, usesAccountId } from "@/lib/platforms";

// Platforms whose token expiry the worker tracks (worker/token_upkeep.py).
const TRACKS_EXPIRY = new Set(["instagram", "threads", "facebook"]);

/**
 * Update a channel's credentials (IG user id + access token). Tokens expire / get
 * regenerated, so editing them is a routine need. The token is write-only here — we
 * never render the stored value back.
 */
export function ChannelCredentials({
  channelId,
  platform,
  remoteAccountId,
  configuredAppId,
}: {
  channelId: number;
  platform: string;
  remoteAccountId: string | null;
  configuredAppId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(remoteAccountId ?? "");
  const [token, setToken] = useState("");
  const [pending, startT] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [tokenCheck, setTokenCheck] = useState<{ valid: boolean; appId: string | null; message: string } | null>(null);

  async function testToken() {
    setTesting(true);
    setTokenCheck(null);
    try {
      const res = await fetch(`/api/channels/${channelId}/test-token`, { method: "POST" });
      const body = await res.json().catch(() => null);
      setTokenCheck(
        res.ok && body
          ? body
          : {
              valid: false,
              appId: null,
              message: body?.error ?? `Token check failed (HTTP ${res.status}). Try again or check the add-on log.`,
            }
      );
      // The result is already displayed locally. router.refresh() asks Next to fetch an
      // unprefixed RSC URL, which Home Assistant ingress cannot route; leaving the page
      // in place also preserves the token result for the user.
    } catch {
      setTokenCheck({ valid: false, appId: null, message: "Could not reach the dashboard. Try again." });
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setMsg(null);
    const body: Record<string, string> = { remote_account_id: accountId.trim() };
    // Only send the token if they typed a new one (leave it untouched otherwise).
    if (token.trim()) body.access_token = token.trim();
    const res = await fetch(`/api/channels/${channelId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setMsg("Could not save.");
      return;
    }
    setToken("");
    // For Meta channels the worker checks a newly saved token on its next cycle and
    // fills in the expiry on the card, so the card is the confirmation. Other
    // platforms have no expiry to show, so they keep the preflight pointer.
    setMsg(
      TRACKS_EXPIRY.has(platform)
        ? "Saved. The worker checks it within a minute — refresh to see its expiry."
        : "Saved — run the preflight check to verify."
    );
    startT(() => router.refresh());
  }

  const field =
    "w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-brand";

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-sunken/40 p-3">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="text-xs font-medium text-ink-soft">Credentials</span>
        {/* Says "Edit", not "Update token" — this panel also edits the account id, and
            labelling it by the token alone hides that. A wrong account id is a real and
            easy mistake (the Threads id is not the Instagram one). */}
        <span className="text-xs text-muted">{open ? "Hide" : "Edit"}</span>
      </button>

      {platform === "facebook" ? (
        <div className="mt-3 space-y-2 text-xs text-ink-soft">
          <p>Configured App ID: <span className="font-mono">{configuredAppId || "Not configured"}</span></p>
          <p>Saved token App ID: <span className="font-mono">{tokenCheck?.appId ?? "Run the token test to check"}</span></p>
          <button onClick={testToken} disabled={testing} className="rounded-md border border-border px-3 py-1.5 font-semibold disabled:opacity-50">
            {testing ? "Testing…" : "Test saved token"}
          </button>
          <div role="status" aria-live="polite">
            {tokenCheck ? <p className={tokenCheck.valid ? "text-status-posted" : "text-status-failed"}>{tokenCheck.message}</p> : null}
          </div>
        </div>
      ) : null}
      {open ? (
        <div className="mt-3 space-y-2.5">
          {platform === "facebook" ? (
            <div className="rounded-md border border-border bg-surface px-2.5 py-3 text-xs text-ink-soft">
              <p>Reconnect this Facebook Page securely through Meta. No token needs to be copied or pasted.</p>
              <a
                href={`/api/channels/facebook/authorize?channelId=${channelId}`}
                className="mt-2 inline-flex rounded-md bg-brand px-3 py-1.5 font-semibold text-on-brand hover:bg-brand-ink"
              >
                Connect with Facebook
              </a>
            </div>
          ) : null}
          {platform !== "facebook" && usesAccountId(platform) ? (
            <label className="block text-xs text-ink-soft">
              <span className="mb-1 block">
                {accountIdLabel(platform)}
              </span>
              <input
                className={field}
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="1784140000..."
              />
            </label>
          ) : null}
          {platform !== "facebook" ? <label className="block text-xs text-ink-soft">
            <span className="mb-1 block">
              {usesAccountId(platform) ? (
                <>
                  New access token{" "}
                  {/* The "IGAA…" prefix is Instagram's; Threads and Page tokens look different,
                      so don't tell someone their valid token looks wrong. */}
                  <span className="text-faint">(long — leave blank to keep the current one)</span>
                </>
              ) : (
                <>
                  New webhook URL{" "}
                  <span className="text-faint">(the whole credential — leave blank to keep the current one)</span>
                </>
              )}
            </span>
            <input
              className={field}
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={
                usesAccountId(platform)
                  ? "Paste the freshly generated token"
                  : "Paste the full Discord webhook URL"
              }
            />
          </label> : null}
          {platform !== "facebook" ? <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={pending}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand hover:bg-brand-ink disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save credentials"}
            </button>
            {msg ? <span className="text-xs text-status-posted">{msg}</span> : null}
          </div> : null}
        </div>
      ) : null}
    </div>
  );
}
