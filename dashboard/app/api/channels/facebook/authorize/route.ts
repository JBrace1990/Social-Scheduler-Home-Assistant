import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!config.metaAppId || !config.metaAppSecret) {
    return NextResponse.json({ error: "META_APP_ID and META_APP_SECRET are required." }, { status: 500 });
  }
  const state = crypto.randomBytes(24).toString("hex");
  const channelId = req.nextUrl.searchParams.get("channelId") ?? "";
  // Next may normalize req.nextUrl.origin to localhost behind the dev server.
  const origin = req.headers.get("host") === "sm.shopmanyworlds.com:3939"
    ? "https://sm.shopmanyworlds.com:3939"
    : req.nextUrl.origin;
  const redirectUri = `${origin}/api/channels/facebook/callback`;
  const params = new URLSearchParams({
    client_id: config.metaAppId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: "pages_show_list,pages_read_engagement,pages_read_user_content,pages_manage_posts,pages_manage_metadata",
  });
  const response = NextResponse.redirect(
    `https://www.facebook.com/${config.graphVersion}/dialog/oauth?${params}`
  );
  response.cookies.set("facebook_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/",
  });
  response.cookies.set("facebook_oauth_redirect", redirectUri, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/",
  });
  response.cookies.set("facebook_oauth_channel", channelId, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    maxAge: 600,
    path: "/",
  });
  return response;
}
