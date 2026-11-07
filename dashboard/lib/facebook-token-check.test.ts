import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFacebookToken } from "./facebook-token-check";

const config = { graphVersion: "v25.0", appId: "expected-app", appSecret: "secret" };
const good = { app_id: "expected-app", is_valid: true, type: "PAGE", profile_id: "page", scopes: ["pages_manage_posts"], expires_at: 0 };
const reply = (data: object) => (async () => Response.json({ data })) as typeof fetch;

test("accepts a matching valid Page token without disclosing credentials", async () => {
  const result = await checkFacebookToken("private-token", "page", config, reply(good));
  assert.equal(result.valid, true);
  assert.equal(result.appId, "expected-app");
  assert.ok(!JSON.stringify(result).includes("private-token"));
});
test("identifies the old app even if the token is otherwise valid", async () => {
  const result = await checkFacebookToken("token", "page", config, reply({ ...good, app_id: "old-app" }));
  assert.equal(result.valid, false);
  assert.equal(result.appId, "old-app");
});
test("rejects invalid tokens and wrong Pages", async () => {
  assert.equal((await checkFacebookToken("token", "page", config, reply({ ...good, is_valid: false }))).valid, false);
  assert.equal((await checkFacebookToken("token", "wrong-page", config, reply(good))).valid, false);
});
test("network failures return a safe result", async () => {
  const fetchImpl = (async () => { throw new Error("private-token secret"); }) as typeof fetch;
  const result = await checkFacebookToken("private-token", "page", config, fetchImpl);
  assert.equal(result.valid, false);
  assert.equal(result.appId, null);
  assert.ok(!JSON.stringify(result).includes("private-token"));
});
