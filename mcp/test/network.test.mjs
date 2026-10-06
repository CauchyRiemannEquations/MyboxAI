import test from "node:test";
import assert from "node:assert/strict";
import tls from "node:tls";
import { createServer, get } from "node:https";
import { configureSystemTrust } from "../src/network.mjs";
import { MyboxClient } from "../dist/core.mjs";
import { trustedCert, trustedKey, untrustedCert, untrustedKey } from "./tls-fixture.mjs";

async function listen(key, cert) {
  const server = createServer({ key, cert }, (_req, res) => { res.writeHead(200); res.end("ok"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `https://127.0.0.1:${server.address().port}/` };
}
function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = get(url, { agent: false, ...options }, res => { res.resume(); resolve(res.statusCode); });
    req.setTimeout(3000, () => req.destroy(new Error("timeout")));
    req.once("error", reject);
  });
}

test("OS trust is added without losing existing roots; real TLS still rejects unknown CAs and hostname mismatch", {
  skip: typeof tls.setDefaultCACertificates !== "function",
}, async () => {
  const previous = tls.getCACertificates("default");
  const trusted = await listen(trustedKey, trustedCert);
  const untrusted = await listen(untrustedKey, untrustedCert);
  try {
    await assert.rejects(request(trusted.url), error => /SELF_SIGNED/.test(error.code));
    configureSystemTrust({
      getCACertificates: type => type === "system" ? [trustedCert] : tls.getCACertificates(type),
      setDefaultCACertificates: certs => tls.setDefaultCACertificates(certs),
    });
    const after = new Set(tls.getCACertificates("default"));
    assert(previous.every(cert => after.has(cert)));
    assert.equal(await request(trusted.url), 200);
    await assert.rejects(request(untrusted.url), error => /SELF_SIGNED/.test(error.code));
    await assert.rejects(request(trusted.url, { servername: "wrong.example" }), error => error.code === "ERR_TLS_CERT_ALTNAME_INVALID");
  } finally {
    tls.setDefaultCACertificates(previous);
    for (const { server } of [trusted, untrusted]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});

test("older Node runtimes retain their existing verification when OS trust APIs are unavailable", () => {
  assert.equal(configureSystemTrust({}), false);
});

test("MYBOX failures distinguish TLS, DNS and timeout from rejected PATs without revealing secrets", async () => {
  const secret = "synthetic-secret-never-echo-this";
  const cases = [
    ["SELF_SIGNED_CERT_IN_CHAIN", "TypeError", "MYBOX_TLS_ERROR"],
    ["ERR_TLS_CERT_ALTNAME_INVALID", "TypeError", "MYBOX_TLS_ERROR"],
    ["ENOTFOUND", "TypeError", "MYBOX_DNS_ERROR"],
    ["UND_ERR_CONNECT_TIMEOUT", "TypeError", "MYBOX_TIMEOUT"],
    [undefined, "TimeoutError", "MYBOX_TIMEOUT"],
    ["ECONNRESET", "TypeError", "MYBOX_UNAVAILABLE"],
  ];
  for (const [code, name, expected] of cases) {
    const client = new MyboxClient(secret, async () => { const error = new Error(secret, { cause: { code, message: secret } }); error.name = name; throw error; });
    await assert.rejects(client.storage(), error => error.code === expected && !error.message.includes(secret));
  }
  const rejected = new MyboxClient(secret, async () => new Response(null, { status: 401 }));
  await assert.rejects(rejected.storage(), error => error.code === "MYBOX_401");
});
