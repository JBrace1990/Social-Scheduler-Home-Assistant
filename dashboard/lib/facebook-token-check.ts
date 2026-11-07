import { debugToken, verifyPageToken, type MetaAppConfig, type TokenInfo } from "./facebook-connect";

export async function checkFacebookToken(token: string, pageId: string, config: MetaAppConfig, fetchImpl: typeof fetch = fetch) {
  let info: TokenInfo;
  try {
    info = await debugToken(token, config, fetchImpl);
  } catch {
    // A token from another app may not be inspectable with our configured app secret.
    // Meta also allows a token to inspect itself. Never return raw responses or errors.
    try {
      const params = new URLSearchParams({ input_token: token });
      const res = await fetchImpl(`https://graph.facebook.com/${config.graphVersion}/debug_token?${params}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (!res.ok || !body.data) throw new Error("Inspection failed");
      info = body.data;
    } catch {
      return { valid: false, appId: null, configuredAppId: config.appId, message: "Could not verify this token with Facebook. It may be expired, revoked, from another app, or Facebook may be unreachable. Reconnect and try again." };
    }
  }
  const appId = typeof info.app_id === "string" ? info.app_id : null;
  const problem = info.is_valid !== true
    ? "Facebook reports this token is invalid. Reconnect this Page."
    : appId !== config.appId
      ? `This token belongs to app ${appId ?? "unknown"}, but SocialScheduler uses ${config.appId}. Reconnect this Page.`
      : verifyPageToken(info, pageId);
  return { valid: !problem, appId, configuredAppId: config.appId, message: problem ?? "Valid Page token, matching app and Page, with publishing permission and no token expiry. This does not confirm public post visibility or the app's Live status." };
}
