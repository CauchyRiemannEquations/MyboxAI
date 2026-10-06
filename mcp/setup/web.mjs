import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { SetupError } from "./core.mjs";

export async function startSetupServer(setup, { port = 0 } = {}) {
  const key = randomBytes(32).toString("base64url");
  const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("./ui.js", import.meta.url), "utf8");
  let origin, busy = false, progress = "앱을 선택하고 MYBOX 토큰을 입력하세요.";
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    const reply = (status, value) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== new URL(origin).host) return reply(403, { message: "허용되지 않은 호스트입니다." });
      if (req.method === "GET" && req.url === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(html); }
      if (req.method === "GET" && req.url === "/ui.js") { res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" }); return res.end(script); }
      if (req.method === "GET" && req.url === "/favicon.ico") { res.writeHead(204); return res.end(); }
      if (req.headers["x-mybox-setup"] !== key || (req.headers.origin && req.headers.origin !== origin)) return reply(403, { message: "이 실행에서 열린 설치 화면을 사용하세요." });
      if (req.method === "GET" && req.url === "/api/state") return reply(200, { ...await setup.state(), busy, progress });
      if (req.method === "GET" && req.url === "/api/progress") return reply(200, { busy, progress });
      if (req.method !== "POST" || !["/api/install", "/api/doctor", "/api/close"].includes(req.url)) return reply(404, { message: "잘못된 요청입니다." });
      // Browsers must send an exact same-origin JSON request with the per-run capability.
      if (req.headers.origin !== origin || req.headers["content-type"] !== "application/json") return reply(403, { message: "허용되지 않은 요청입니다." });
      if (busy) return reply(409, { message: "진행 중인 작업이 끝날 때까지 기다려 주세요." });
      let body = "";
      for await (const chunk of req) { body += chunk.toString("utf8"); if (Buffer.byteLength(body) > 8192) return reply(413, { message: "입력 크기를 확인하세요." }); }
      let input;
      try { input = JSON.parse(body); } catch { return reply(400, { message: "입력 형식을 확인하세요." }); }
      if (req.url === "/api/close") { reply(200, { message: "설치 도우미를 종료했습니다. 이 탭을 닫으세요." }); server.close(); server.closeIdleConnections(); return; }
      busy = true;
      try {
        if (req.url === "/api/doctor") progress = "MYBOX API 연결과 MCP 실행을 진단하고 있습니다.";
        const result = req.url === "/api/install" ? await setup.install(input, value => { progress = value; }) : await setup.doctor();
        progress = result.message;
        reply(200, result);
      } finally { busy = false; }
    } catch (error) {
      progress = error instanceof SetupError ? error.message : "작업을 완료하지 못했습니다. 입력과 설정 파일을 확인하세요.";
      if (!res.headersSent) reply(400, { message: progress });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  // A URL fragment is not sent in HTTP requests or Referer headers; no secret in server logs.
  return { server, url: `${origin}/#${key}`, origin };
}
