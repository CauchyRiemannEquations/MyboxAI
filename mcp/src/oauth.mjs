import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { InvalidGrantError, InvalidTokenError, InvalidClientMetadataError, InvalidScopeError, InvalidRequestError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const nonce = () => randomBytes(32).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);
const escape = text => String(text).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const digest = value => createHash("sha256").update(value).digest();

// This is a single-owner server: every explicitly approved client accesses one MYBOX account.
// Credentials and grants are memory-only. Restarting revokes every connection.
export class OwnerOAuthProvider {
  constructor(publicUrl, ownerSecret) {
    this.publicUrl = publicUrl;
    this.resource = new URL("/mcp", publicUrl);
    this.ownerSecretDigest = digest(ownerSecret);
    this.clients = new Map(); this.pending = new Map(); this.codes = new Map(); this.access = new Map(); this.refresh = new Map();
    this.failedLogins = [];
    this.clientsStore = {
      getClient: clientId => this.clients.get(clientId),
      registerClient: client => {
        if (this.clients.size >= 100) throw new ServerError("Client limit reached. Restart the server to clear registrations.");
        if (!client.redirect_uris?.length || client.redirect_uris.length > 10) throw new InvalidClientMetadataError("Invalid redirect URIs");
        for (const raw of client.redirect_uris) {
          let url;
          try { url = new URL(raw); } catch { throw new InvalidClientMetadataError("Invalid redirect URI"); }
          const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
          if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.hash || url.username || url.password || raw.length > 2048) {
            throw new InvalidClientMetadataError("Use HTTPS or a local loopback redirect URI");
          }
        }
        const registered = { ...client, client_id: nonce(), client_id_issued_at: now() };
        this.clients.set(registered.client_id, registered);
        return registered;
      },
    };
  }
  clean() {
    const time = now();
    for (const map of [this.pending, this.codes, this.access, this.refresh]) for (const [key, value] of map) if (value.expiresAt <= time) map.delete(key);
    this.failedLogins = this.failedLogins.filter(time => time > now() - 60);
  }
  validateRequest(scopes, resource) {
    if (scopes?.some(scope => scope !== "mybox:read")) throw new InvalidScopeError("Only mybox:read is supported");
    if (resource && resource.toString().replace(/\/$/, "") !== this.resource.toString()) throw new InvalidRequestError("Wrong resource");
  }
  async authorize(client, params, res) {
    this.clean(); this.validateRequest(params.scopes, params.resource);
    if (this.pending.size >= 100) throw new ServerError("Too many pending authorizations");
    const ticket = nonce(), cookie = nonce();
    this.pending.set(ticket, { client, params, cookie, expiresAt: now() + 300 });
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Set-Cookie", `mybox_auth=${cookie}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300${this.publicUrl.protocol === "https:" ? "; Secure" : ""}`);
    res.type("html").send(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MyboxAI 연결</title>
<style>body{font:17px system-ui;max-width:520px;margin:60px auto;padding:24px;line-height:1.7}input,button{box-sizing:border-box;width:100%;padding:14px;font:inherit;margin-top:12px}button{background:#087e43;color:white;border:0;border-radius:8px}</style>
<h1>MyboxAI 읽기 연결</h1><p><strong>${escape(client.client_name || "MCP 클라이언트")}</strong>에 이 서버의 MYBOX 파일 검색·읽기를 허용합니다.</p>
<p>서버 소유자가 설정한 <code>MCP_OWNER_SECRET</code>을 입력하세요. MYBOX 토큰을 입력하는 칸이 아닙니다.</p>
<form method="post" action="/approve"><input type="hidden" name="ticket" value="${ticket}"><label>서버 연결 암호<input name="secret" type="password" autocomplete="current-password" required maxlength="1024"></label><button type="submit">파일 검색·읽기 연결 허용</button></form>
<p>원본 파일 변경·삭제 기능은 없습니다. 승인한 앱이 검색 결과와 문서를 받아 처리합니다.</p></html>`);
  }
  approve(req, res) {
    this.clean();
    const entry = this.pending.get(req.body?.ticket);
    const cookie = req.headers.cookie?.split(";").map(value => value.trim()).find(value => value.startsWith("mybox_auth="))?.slice(11);
    if (!entry || cookie !== entry.cookie || req.headers.origin !== this.publicUrl.origin) return res.status(400).send("연결 요청이 만료되었거나 올바르지 않습니다. 앱에서 다시 연결해 주세요.");
    if (this.failedLogins.length >= 10) return res.status(429).send("잠시 후 다시 연결해 주세요.");
    const candidate = typeof req.body?.secret === "string" ? req.body.secret : "";
    if (candidate.length > 1024 || !timingSafeEqual(digest(candidate), this.ownerSecretDigest)) {
      this.failedLogins.push(now()); return res.status(403).send("서버 연결 암호가 올바르지 않습니다. 앱에서 연결을 다시 시작해 주세요.");
    }
    this.pending.delete(req.body.ticket);
    const code = nonce();
    this.codes.set(code, { clientId: entry.client.client_id, challenge: entry.params.codeChallenge, redirectUri: entry.params.redirectUri, expiresAt: now() + 120 });
    const redirect = new URL(entry.params.redirectUri);
    redirect.searchParams.set("code", code);
    if (entry.params.state !== undefined) redirect.searchParams.set("state", entry.params.state);
    redirect.searchParams.set("iss", this.publicUrl.toString());
    res.setHeader("Cache-Control", "no-store");
    return res.redirect(303, redirect.toString());
  }
  async challengeForAuthorizationCode(client, code) {
    this.clean(); const entry = this.codes.get(code);
    if (!entry || entry.clientId !== client.client_id) throw new InvalidGrantError("Invalid authorization code");
    return entry.challenge;
  }
  issue(clientId) {
    this.clean();
    if (this.access.size + this.refresh.size >= 1000) throw new ServerError("Token limit reached");
    const accessToken = nonce(), refreshToken = nonce(), grantId = nonce();
    this.access.set(accessToken, { clientId, grantId, expiresAt: now() + 3600 });
    this.refresh.set(refreshToken, { clientId, grantId, expiresAt: now() + 7 * 86400 });
    return { access_token: accessToken, token_type: "Bearer", expires_in: 3600, refresh_token: refreshToken, scope: "mybox:read" };
  }
  async exchangeAuthorizationCode(client, code, _verifier, redirectUri, resource) {
    this.clean(); this.validateRequest(undefined, resource);
    const entry = this.codes.get(code);
    if (!entry || entry.clientId !== client.client_id || (redirectUri && redirectUri !== entry.redirectUri)) throw new InvalidGrantError("Invalid authorization code");
    this.codes.delete(code);
    return this.issue(client.client_id);
  }
  async exchangeRefreshToken(client, token, scopes, resource) {
    this.clean(); this.validateRequest(scopes, resource);
    const entry = this.refresh.get(token);
    if (!entry || entry.clientId !== client.client_id) throw new InvalidGrantError("Invalid refresh token");
    // Rotate both refresh and access tokens in the previous grant.
    this.refresh.delete(token);
    for (const [key, access] of this.access) if (access.grantId === entry.grantId) this.access.delete(key);
    return this.issue(client.client_id);
  }
  async verifyAccessToken(token) {
    this.clean(); const entry = this.access.get(token);
    if (!entry) throw new InvalidTokenError("Invalid or expired access token");
    return { token, clientId: entry.clientId, expiresAt: entry.expiresAt, scopes: ["mybox:read"], resource: this.resource };
  }
  async revokeToken(client, request) {
    const entry = this.access.get(request.token) || this.refresh.get(request.token);
    if (!entry || entry.clientId !== client.client_id) return;
    for (const map of [this.access, this.refresh]) for (const [key, value] of map) if (value.grantId === entry.grantId) map.delete(key);
  }
}
