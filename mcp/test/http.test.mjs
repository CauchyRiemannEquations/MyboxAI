import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createHash } from "node:crypto";
import { createHttpApp } from "../dist/http.mjs";
import { mockClient, mixedPdf } from "./fixtures.mjs";

const secret = "fixture-owner-secret-32-characters-minimum";
const verifier = "fixture-pkce-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
const challenge = createHash("sha256").update(verifier).digest("base64url");
async function fixture(task) {
  const listener = createServer(); await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;
  const { client } = mockClient("math.pdf", mixedPdf());
  const { app, provider } = createHttpApp({ publicUrl: base, ownerSecret: secret, client });
  listener.on("request", app);
  try { await task(base, provider); } finally { await new Promise(resolve => listener.close(resolve)); }
}
async function register(base) {
  const response = await fetch(base + "/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    client_name: "Test agent", redirect_uris: ["http://127.0.0.1:54321/callback"], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  }) });
  assert.equal(response.status, 201); return response.json();
}
async function authorize(base, client) {
  const url = new URL(base + "/authorize");
  for (const [key, value] of Object.entries({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "mybox:read", state: "fixture-state", resource: base + "/mcp" })) url.searchParams.set(key, value);
  const response = await fetch(url); assert.equal(response.status, 200);
  const html = await response.text(), cookie = response.headers.get("set-cookie").split(";")[0];
  const ticket = html.match(/name="ticket" value="([^"]+)"/)[1];
  return { ticket, cookie };
}
async function approve(base, pending, value = secret, extras = {}) {
  return fetch(base + "/approve", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: base, Cookie: pending.cookie, ...extras }, body: new URLSearchParams({ ticket: pending.ticket, secret: value }) });
}
async function tokenRequest(base, args) {
  return fetch(base + "/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(args) });
}

test("remote server requires HTTPS off-loopback, an owner secret, and MYBOX credentials", () => {
  assert.throws(() => createHttpApp({ publicUrl: "http://example.com", ownerSecret: secret, token: "fixture" }), error => error.code === "INVALID_PUBLIC_URL");
  assert.throws(() => createHttpApp({ publicUrl: "https://example.com", ownerSecret: "short", token: "fixture" }), error => error.code === "OWNER_SECRET_REQUIRED");
  assert.throws(() => createHttpApp({ publicUrl: "https://example.com", ownerSecret: secret }), error => error.code === "TOKEN_REQUIRED");
});

test("remote discovery is public while MYBOX tools reject anonymous requests and foreign origins", async () => fixture(async base => {
  const resource = await fetch(base + "/.well-known/oauth-protected-resource/mcp"); assert.equal(resource.status, 200);
  assert.equal((await resource.json()).resource, base + "/mcp");
  const response = await fetch(base + "/mcp", { method: "POST" }); assert.equal(response.status, 401);
  assert(response.headers.get("www-authenticate").includes("resource_metadata="));
  const foreign = await fetch(base + "/mcp", { method: "POST", headers: { Origin: "https://evil.example" } }); assert.equal(foreign.status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const call = request(base + "/health", { headers: { Host: "evil.example" } }, response => { response.resume(); resolve(response.statusCode); });
    call.on("error", reject); call.end();
  });
  assert.equal(hostStatus, 400);
}));

test("OAuth needs owner approval and a matching browser cookie/origin", async () => fixture(async base => {
  const client = await register(base), pending = await authorize(base, client);
  assert.equal((await approve(base, pending, "wrong-secret")).status, 403);
  assert.equal((await approve(base, pending, secret, { Cookie: "" })).status, 400);
  assert.equal((await approve(base, pending, secret, { Origin: "https://evil.example" })).status, 400);
  const approved = await approve(base, pending); assert.equal(approved.status, 303);
  const redirect = new URL(approved.headers.get("location")); assert.equal(redirect.searchParams.get("state"), "fixture-state");
  assert.equal(redirect.searchParams.get("iss"), base + "/");
  assert.equal((await approve(base, pending)).status, 400);
}));

test("OAuth PKCE, authenticated MCP images, refresh rotation, and revocation work end to end", async () => fixture(async base => {
  const client = await register(base), pending = await authorize(base, client), approved = await approve(base, pending);
  const code = new URL(approved.headers.get("location")).searchParams.get("code");
  const request = { grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: client.redirect_uris[0], resource: base + "/mcp" };
  const invalid = await tokenRequest(base, { ...request, code_verifier: "wrong-verifier" }); assert.equal(invalid.status, 400);
  const response = await tokenRequest(base, { ...request, code_verifier: verifier }); assert.equal(response.status, 200);
  const tokens = await response.json();
  assert.equal((await tokenRequest(base, { ...request, code_verifier: verifier })).status, 400);
  const rpc = body => fetch(base + "/mcp", { method: "POST", headers: { Authorization: `Bearer ${tokens.access_token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify(body) });
  const initialized = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fixture", version: "1.0" } } });
  assert.equal(initialized.status, 200); assert.equal((await initialized.json()).result.serverInfo.name, "MyboxAI");
  const read = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "fetch", arguments: { id: "fixture", start_page: 2, page_count: 1 } } });
  assert.equal(read.status, 200); const result = (await read.json()).result; assert(!result.isError); assert(result.content.some(item => item.type === "image"));
  const refresh = await tokenRequest(base, { grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token, resource: base + "/mcp" });
  assert.equal(refresh.status, 200); const rotated = await refresh.json(); assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  assert.equal((await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })).status, 401);
  const revoke = await fetch(base + "/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: rotated.refresh_token, client_id: client.client_id }) }); assert.equal(revoke.status, 200);
  assert.equal((await tokenRequest(base, { grant_type: "refresh_token", client_id: client.client_id, refresh_token: rotated.refresh_token })).status, 400);
}));

test("dynamic registration rejects malicious redirect schemes", async () => fixture(async base => {
  const response = await fetch(base + "/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"], token_endpoint_auth_method: "none" }) });
  assert.equal(response.status, 400);
}));
