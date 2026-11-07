import { NextResponse } from "next/server";
import { getChannel } from "@/lib/queries";
import { config } from "@/lib/config";
import { checkFacebookToken } from "@/lib/facebook-token-check";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channel = getChannel(Number(id));
  if (!channel) return NextResponse.json({ error: "Channel not found." }, { status: 404 });
  if (channel.platform !== "facebook") return NextResponse.json({ error: "This check supports Facebook Pages." }, { status: 400 });
  if (!channel.access_token || !channel.remote_account_id) return NextResponse.json({ error: "Connect this Page first." }, { status: 400 });
  const result = await checkFacebookToken(channel.access_token, channel.remote_account_id, {
    graphVersion: config.graphVersion, appId: config.metaAppId, appSecret: config.metaAppSecret,
  });
  if (result.valid) {
    // Only clear the status of the credential actually tested, even if a reconnect
    // replaced it while the Meta request was in flight.
    getDb().prepare(`UPDATE channels SET token_error = NULL,
      token_expires_at = NULL, token_next_check_at = ?
      WHERE id = ? AND access_token = ? AND remote_account_id = ?`)
      .run(new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        channel.id, channel.access_token, channel.remote_account_id);
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
