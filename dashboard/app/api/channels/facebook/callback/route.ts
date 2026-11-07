import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { getChannel, getChannels, updateChannel } from "@/lib/queries";
import { debugToken, extendUserToken, verifyPageToken } from "@/lib/facebook-connect";

export const runtime = "nodejs";

function dashboardOrigin(req: NextRequest) {
  return req.headers.get("host") === "sm.shopmanyworlds.com:3939"
    ? "https://sm.shopmanyworlds.com:3939"
    : req.nextUrl.origin;
}

function back(req: NextRequest, message: string) {
  const url = new URL("/channels", dashboardOrigin(req));
  url.searchParams.set("facebook_oauth_error", message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  const jar = await cookies();
  const expected = jar.get("facebook_oauth_state")?.value;
  const supplied = req.nextUrl.searchParams.get("state");
  if (!expected || !supplied || expected !== supplied) return back(req, "Facebook authorization expired. Try again.");
  const error = req.nextUrl.searchParams.get("error_description");
  if (error) return back(req, error);
  const code = req.nextUrl.searchParams.get("code");
  const redirectUri = jar.get("facebook_oauth_redirect")?.value;
  if (!code || !redirectUri) return back(req, "Facebook did not return an authorization code.");

  const tokenParams = new URLSearchParams({
    client_id: config.metaAppId,
    client_secret: config.metaAppSecret,
    redirect_uri: redirectUri,
    code,
  });
  let tokenRes: Response;
  try {
    tokenRes = await fetch(`https://graph.facebook.com/${config.graphVersion}/oauth/access_token?${tokenParams}`, {
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return back(req, "The dashboard could not reach Facebook. Check its network access, then reconnect.");
  }
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || typeof tokenBody.access_token !== "string") {
    if (tokenBody.error?.code === 190 || /client secret|signature/i.test(String(tokenBody.error?.message ?? ""))) {
      return back(req, `Facebook rejected the app credentials. Check that META_APP_SECRET belongs to app ${config.metaAppId}, then restart the dashboard and reconnect.`);
    }
    return back(req, "Facebook could not complete the token exchange. Check the redirect URL and app settings.");
  }
  const shortLivedUserToken = tokenBody.access_token as string;
  let userToken: string;
  try {
    userToken = await extendUserToken(shortLivedUserToken, {
      graphVersion: config.graphVersion,
      appId: config.metaAppId,
      appSecret: config.metaAppSecret,
    });
  } catch {
    return back(req, "Facebook authorized the login, but the server could not extend the user token. Check the Meta app credentials.");
  }
  const pagesUrl = new URL(`https://graph.facebook.com/${config.graphVersion}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,access_token,tasks");
  pagesUrl.searchParams.set("limit", "100");
  pagesUrl.searchParams.set("access_token", userToken);
  let pagesRes: Response;
  try {
    pagesRes = await fetch(pagesUrl, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch {
    return back(req, "The dashboard could not fetch your Facebook Pages. Check its network access, then reconnect.");
  }
  const pagesBody = await pagesRes.json().catch(() => ({}));
  const pages = Array.isArray(pagesBody.data) ? pagesBody.data : [];
  const page = pages.find((p: { access_token?: unknown; tasks?: unknown }) => typeof p?.access_token === "string" && Array.isArray(p?.tasks) && p.tasks.includes("CREATE_CONTENT") && p.tasks.includes("MANAGE"));
  if (!page) return back(req, "Facebook authorized successfully, but no Page with publishing access was returned.");

  const pageToken = String(page.access_token);
  const pageId = String(page.id);
  try {
    const info = await debugToken(pageToken, {
      graphVersion: config.graphVersion,
      appId: config.metaAppId,
      appSecret: config.metaAppSecret,
    });
    const tokenProblem = verifyPageToken(info, pageId);
    if (tokenProblem) return back(req, tokenProblem);
    if (info.is_valid !== true || info.app_id !== config.metaAppId) {
      return back(req, "Facebook returned an invalid token or a token from another app. No credentials were changed.");
    }
  } catch {
    return back(req, "Facebook returned a Page token, but the app could not verify it. Try connecting again.");
  }
  const requestedChannelId = Number(jar.get("facebook_oauth_channel")?.value || 0);
  const channel = getChannels().find((c) =>
    c.platform === "facebook" &&
    (requestedChannelId ? c.id === requestedChannelId : c.remote_account_id === pageId)
  );
  if (!channel) return back(req, `Facebook returned Page ${pageId}, but no matching channel exists yet. Add it once, then reconnect.`);
  try {
    updateChannel(channel.id, {
    access_token: pageToken,
    remote_account_id: pageId,
    token_expires_at: null,
    token_error: null,
    token_next_check_at: null,
    });
    const saved = getChannel(channel.id);
    if (saved?.access_token !== pageToken || saved.remote_account_id !== pageId) {
      return back(req, "The new Page credentials could not be confirmed in the database. Try reconnecting again.");
    }
  } catch {
    return back(req, "The dashboard could not save the new Page credentials. Check database access and reconnect.");
  }
  const success = new URL("/channels", dashboardOrigin(req));
  success.searchParams.set("facebook_oauth", "connected");
  return NextResponse.redirect(success);
}
