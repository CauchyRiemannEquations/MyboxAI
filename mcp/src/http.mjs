import express from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { createServer, loadToken } from "./server.mjs";
import { OwnerOAuthProvider } from "./oauth.mjs";
import { AppError } from "./core.mjs";

export function createHttpApp({ publicUrl, ownerSecret, token, client, tempRoot } = {}) {
  const url = new URL(publicUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new AppError("INVALID_PUBLIC_URL", "MCP_PUBLIC_URL에는 HTTPS 주소의 도메인만 입력하세요. 로컬 테스트에서는 http://127.0.0.1을 사용할 수 있습니다.");
  }
  if (typeof ownerSecret !== "string" || ownerSecret.length < 32 || ownerSecret.length > 1024) throw new AppError("OWNER_SECRET_REQUIRED", "32자 이상의 MCP_OWNER_SECRET을 설정하세요.");
  if (!token && !client) throw new AppError("TOKEN_REQUIRED", "원격 서버에는 MYBOX_TOKEN을 설정해야 합니다.");
  const provider = new OwnerOAuthProvider(url, ownerSecret);
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.headers.host !== url.host) return res.status(400).json({ error: "invalid_host" });
    const allowedOrigins = [url.origin, "https://chatgpt.com", "https://claude.ai", "https://gemini.google.com"];
    if (req.path === "/mcp" && req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return res.status(403).json({ error: "invalid_origin" });
    next();
  });
  app.use(mcpAuthRouter({ provider, issuerUrl: url, baseUrl: url, resourceServerUrl: provider.resource, resourceName: "MyboxAI", scopesSupported: ["mybox:read"] }));
  app.post("/approve", express.urlencoded({ extended: false, limit: "8kb" }), (req, res) => provider.approve(req, res));
  app.get("/", (_req, res) => res.type("text").send("MyboxAI MCP: /mcp. 연결하려면 MCP를 지원하는 앱에 이 서버의 HTTPS /mcp 주소를 등록하세요."));
  app.get("/health", (_req, res) => res.json({ ok: true, service: "MyboxAI" }));
  const auth = requireBearerAuth({ verifier: provider, requiredScopes: ["mybox:read"], expectedResource: provider.resource,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(provider.resource) });
  let running = 0;
  app.post("/mcp", auth, express.json({ limit: "1mb" }), async (req, res) => {
    if (running >= 4) { res.setHeader("Retry-After", "5"); return res.status(429).json({ error: "busy" }); }
    running++;
    const server = createServer({ token, client, tempRoot });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: "unavailable" });
    } finally {
      running--;
      await server.close();
      await transport.close();
    }
  });
  app.all("/mcp", auth, (_req, res) => { res.setHeader("Allow", "POST"); res.status(405).end(); });
  app.use((error, _req, res, _next) => {
    if (!res.headersSent) res.status(error?.status === 413 ? 413 : 400).json({ error: "invalid_request" });
  });
  return { app, provider };
}

async function main() {
  console.log = console.info = console.debug = console.warn = () => {};
  try { process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url))); }
  catch (error) { if (error.code !== "ENOENT") throw new AppError("INVALID_ENV", ".env 파일을 확인하세요."); }
  const token = await loadToken();
  const port = Number(process.env.PORT || 3001), host = process.env.HOST || "127.0.0.1";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AppError("INVALID_PORT", "PORT를 확인하세요.");
  const { app } = createHttpApp({ publicUrl: process.env.MCP_PUBLIC_URL, ownerSecret: process.env.MCP_OWNER_SECRET, token });
  const listener = app.listen(port, host, () => process.stderr.write("MyboxAI 원격 MCP 서버가 시작되었습니다.\n"));
  const stop = () => { listener.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  process.stderr.write(`MyboxAI: ${error instanceof AppError ? error.message : "원격 MCP 서버를 시작하지 못했습니다."}\n`); process.exitCode = 1;
});
