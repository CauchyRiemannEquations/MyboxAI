import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink, readdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { PassThrough } from "node:stream";
import { parse as parseToml } from "smol-toml";
import { parse as parseJson } from "jsonc-parser";
import { createSetup, SetupError } from "../setup/core.mjs";
import { startSetupServer } from "../setup/web.mjs";
import { promptSecret, main } from "../setup/main.mjs";
import { LOCAL_TOOL_NAMES } from "../dist/server.mjs";

const token = "mbx_pat_" + "fixture-token-never-a-real-credential";
const root = fileURLToPath(new URL("../../", import.meta.url));
async function fixture(task, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "mybox-setup-"));
  const installRoot = path.join(directory, "한글 폴더", "Mybox AI");
  const home = path.join(directory, "home");
  const calls = [];
  const setup = createSetup({ root: installRoot, home, env: {}, platform: "win32", smoke: async () => 6, transport: async (url, init) => {
    calls.push({ url: String(url), init }); return Response.json({ usedSize: 123 });
  }, ...options });
  try { await task({ setup, installRoot, home, directory, calls }); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
async function put(file, text) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, text); }
async function exists(file) { return stat(file).then(() => true, () => false); }

test("installer registers five clients, preserves unrelated config/comments, and keeps PAT out of configs/results", async () => fixture(async ({ setup, calls }) => {
  const codex = setup.targets.find(target => target.id === "codex");
  const claude = setup.targets.find(target => target.id === "claude");
  const gemini = setup.targets.find(target => target.id === "gemini");
  const original = '# Keep this comment\nmodel = "existing-model"\n[mcp_servers.other]\ncommand = "other"\n[mcp_servers.mybox]\nurl = "https://old.example/mcp"\n[mcp_servers.mybox.env]\nOLD = "preserve-in-backup"\n[projects."C:/hello"]\ntrust_level = "trusted"\n';
  await put(codex.file, original);
  await put(claude.file, '{"projects":{"existing":{"trusted":true}},"mcpServers":{"other":{"command":"other"}}}\n');
  await put(gemini.file, '// comment\n{ "theme": "dark", "mcpServers": {"other": {"command": "other"},},}\n');
  const result = await setup.install({ token, agents: setup.targets.map(target => target.id) });
  assert.equal(result.toolCount, 6); assert.equal(result.apiVerified, true);
  assert.equal(calls[0].url, "https://open-api.mybox.naver.com/v1/drive/storage");
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(await readFile(setup.tokenFile, "utf8"), token + "\n");
  if (process.platform !== "win32") assert.equal((await stat(setup.tokenFile)).mode & 0o777, 0o600);
  for (const target of setup.targets) {
    const text = await readFile(target.file, "utf8");
    assert(!text.includes(token));
    const entry = target.type === "toml" ? parseToml(text).mcp_servers.mybox : parseJson(text).mcpServers.mybox;
    assert.equal(entry.command, process.execPath);
    assert(entry.args[0].includes("한글 폴더"));
    assert.deepEqual({ ...entry.env }, { MYBOX_TOKEN: "", MYBOX_TOKEN_FILE: setup.tokenFile });
  }
  const toml = await readFile(codex.file, "utf8");
  assert(toml.includes("# Keep this comment")); assert.equal(parseToml(toml).model, "existing-model");
  assert.equal(parseToml(toml).mcp_servers.other.command, "other");
  assert.equal(parseJson(await readFile(claude.file, "utf8")).projects.existing.trusted, true);
  assert((await readFile(gemini.file, "utf8")).includes("// comment"));
  assert.equal(await readFile(result.backups[0], "utf8"), original);
  assert(!JSON.stringify(result).includes(token)); assert(!JSON.stringify(await setup.state()).includes(token));
}));

test("reinstall reuses saved token without duplicate TOML entries; rotation changes only the private token", async () => fixture(async ({ setup }) => {
  await setup.install({ token, agents: ["codex"] });
  const initial = await readFile(setup.targets[0].file, "utf8");
  const second = await setup.install({ agents: ["codex"] });
  assert.equal(second.backups.length, 0);
  assert.equal(await readFile(setup.targets[0].file, "utf8"), initial);
  const rotated = token + "-rotated";
  await setup.install({ token: rotated, agents: ["codex"] });
  assert.equal(await readFile(setup.tokenFile, "utf8"), rotated + "\n");
  assert.equal(await readFile(setup.targets[0].file, "utf8"), initial);
}));

test("Windows UTF-8 BOM configs remain valid and retain unrelated settings", async () => fixture(async ({ setup }) => {
  const target = setup.targets.find(value => value.id === "gemini");
  await put(target.file, '\uFEFF{ "theme": "dark" }\n');
  await setup.install({ token, agents: ["gemini"] });
  const text = await readFile(target.file, "utf8");
  assert(text.startsWith("\uFEFF"));
  assert.equal(parseJson(text.slice(1)).theme, "dark");
  assert.equal(parseJson(text.slice(1)).mcpServers.mybox.env.MYBOX_TOKEN_FILE, setup.tokenFile);
}));

test("noninteractive CLI installs selected clients from a private token file and doctor succeeds", async t => fixture(async ({ setup, directory }) => {
  // Node 22's test runner can corrupt its IPC stream when non-ASCII application
  // stdout is mixed with test events (nodejs/node#65934). Capture CLI output here.
  const lines = [];
  t.mock.method(console, "log", (...values) => { lines.push(values.join(" ")); });
  const file = path.join(directory, "private", "pat.txt");
  await put(file, token + "\n");
  await main(["--cli", "--agents", "codex,claude", "--token-file", file, "--yes"], setup);
  assert.equal(await readFile(setup.tokenFile, "utf8"), token + "\n");
  assert.equal(await exists(setup.targets[0].file), true);
  assert.equal(await exists(setup.targets[1].file), true);
  await main(["--doctor"], setup);
  assert(lines.some(line => line.includes("설치 완료")));
  assert(!lines.join("\n").includes(token));
}));

test("malformed configs and conflicting TOML forms cause no writes or API requests", async () => fixture(async ({ setup, calls }) => {
  const target = setup.targets[0];
  for (const text of ['mcp_servers = { mybox = { command = "old" } }\n', 'secret = "unfinished']) {
    await put(target.file, text);
    await assert.rejects(setup.install({ token, agents: ["codex"] }), SetupError);
    assert.equal(await readFile(target.file, "utf8"), text);
    assert.equal(await exists(setup.tokenFile), false);
  }
  await put(setup.targets[1].file, '{"secret":"do-not-echo", broken}');
  await assert.rejects(setup.install({ token, agents: ["claude"] }), error => !error.message.includes("do-not-echo"));
  assert.equal(calls.length, 0);
}));

test("malformed PAT and rejected API authentication never modify settings or echo credentials", async () => fixture(async ({ setup }) => {
  await assert.rejects(setup.install({ token: "private-value-do-not-echo", agents: ["codex"] }), error => !error.message.includes("private-value-do-not-echo"));
  assert.equal(await exists(setup.tokenFile), false);
}, { transport: async () => new Response("denied", { status: 401 }) }));

test("API failure occurs before writing a valid PAT", async () => fixture(async ({ setup }) => {
  await assert.rejects(setup.install({ token, agents: ["codex"] }), /토큰/);
  assert.equal(await exists(setup.tokenFile), false);
  assert.equal(await exists(setup.targets[0].file), false);
}, { transport: async () => new Response("denied", { status: 401 }) }));

test("MCP failure rolls back the previous token and config, removing newly created configs", async () => fixture(async ({ setup }) => {
  const original = 'model = "keep-me"\n';
  await put(setup.targets[0].file, original);
  await put(setup.tokenFile, token + "\n");
  await assert.rejects(setup.install({ token: token + "-rotated", agents: ["codex", "claude"] }), /MCP/);
  assert.equal(await readFile(setup.targets[0].file, "utf8"), original);
  assert.equal(await readFile(setup.tokenFile, "utf8"), token + "\n");
  assert.equal(await exists(setup.targets[1].file), false);
}, { smoke: async () => { throw new SetupError("MCP 실패"); } }));

test("installer detects concurrent edits and preserves them when rolling back its own writes", async () => {
  let changedFile;
  await fixture(async ({ setup }) => {
    changedFile = setup.targets[0].file;
    await assert.rejects(setup.install({ token, agents: ["codex"] }), /복원/);
    assert.equal(await readFile(changedFile, "utf8"), "concurrent-edit");
    assert.equal(await exists(setup.tokenFile), false);
  }, { smoke: async () => { await writeFile(changedFile, "concurrent-edit"); throw new Error(); } });
});

test("saved private token wins over stale environment; CODEX_HOME is respected", async () => fixture(async ({ setup, calls }) => {
  await put(setup.tokenFile, token);
  await setup.install({ agents: ["codex"] });
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
}, { env: { MYBOX_TOKEN: "mbx_pat_stale-token-from-shell", CODEX_HOME: path.join(root, "dist", "setup-test-codex") } }).finally(async () => {
  // CODEX_HOME fixture stays in generated MCP build output, never the user's config.
  await rm(path.join(root, "dist", "setup-test-codex"), { recursive: true, force: true });
}));

test("installer imports a legacy .env PAT and doctor does not persist/register anything", async () => fixture(async ({ setup, installRoot }) => {
  await put(path.join(installRoot, "mcp", ".env"), `MYBOX_TOKEN=${token}\nOTHER=keep\n`);
  assert.equal((await setup.state()).configured, true);
  assert.equal((await setup.doctor()).ok, true);
  assert.equal(await exists(setup.tokenFile), false);
  assert.equal(await exists(setup.targets[0].file), false);
  await setup.install({ agents: ["gemini"] });
  assert.equal(await readFile(path.join(installRoot, "mcp", ".env"), "utf8"), `MYBOX_TOKEN=${token}\nOTHER=keep\n`);
}));

test("installer refuses symlink configs", { skip: process.platform === "win32" }, async () => fixture(async ({ setup, directory }) => {
  const target = setup.targets[0];
  const file = path.join(directory, "original"); await put(file, 'model = "keep"');
  await mkdir(path.dirname(target.file), { recursive: true }); await symlink(file, target.file);
  await assert.rejects(setup.install({ token, agents: ["codex"] }), SetupError);
  assert.equal(await readFile(file, "utf8"), 'model = "keep"');
}));

test("actual installed entry launches MCP from a Korean/spaced folder without relying on PATH or CWD", async () => {
  const directory = await mkdtemp(path.join(root, "mcp", "dist", "setup-real-"));
  try {
    const installRoot = path.join(directory, "한글 띄어쓰기");
    await mkdir(path.join(installRoot, "mcp"), { recursive: true });
    await mkdir(path.join(installRoot, "mcp", "dist"));
    for (const file of await readdir(path.join(root, "mcp", "dist"))) {
      if (file.endsWith(".mjs")) await cp(path.join(root, "mcp", "dist", file), path.join(installRoot, "mcp", "dist", file));
    }
    const setup = createSetup({ root: installRoot, home: path.join(directory, "home"), env: {}, transport: async () => Response.json({ usedSize: 123 }) });
    const result = await setup.install({ token, agents: ["codex"] });
    assert.equal(result.toolCount, LOCAL_TOOL_NAMES.length);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("hidden CLI prompt handles paste/backspace/cancel without echoing the token and restores terminal state", async () => {
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = true; input.isRaw = false; input.setRawMode = value => { input.isRaw = value; };
  let printed = ""; output.on("data", data => { printed += data; });
  const answer = promptSecret(input, output); input.write(token + "x\b\r");
  assert.equal(await answer, token); assert(!printed.includes(token)); assert.equal(input.isRaw, false);
  const cancelled = promptSecret(input, output); input.write("\u0003");
  await assert.rejects(cancelled, /취소/); assert.equal(input.isRaw, false);
});

test("setup HTTP UI enforces loopback Host, session capability, Origin, JSON and never returns PAT", async () => fixture(async ({ setup }) => {
  const { server, url, origin } = await startSetupServer(setup);
  const key = new URL(url).hash.slice(1);
  const headers = { "X-Mybox-Setup": key, Origin: origin, "Content-Type": "application/json" };
  try {
    const html = await fetch(origin); assert.equal(html.status, 200);
    assert(html.headers.get("content-security-policy").includes("frame-ancestors 'none'"));
    assert((await html.text()).includes('type="password"'));
    assert.equal((await fetch(origin + "/api/state")).status, 403);
    assert.equal((await fetch(origin + "/api/state", { headers: { "X-Mybox-Setup": key, Origin: "https://evil.example" } })).status, 403);
    const hostStatus = await new Promise((resolve, reject) => { const call = request(origin, { headers: { Host: "evil.example" } }, response => { response.resume(); resolve(response.statusCode); }); call.on("error", reject); call.end(); });
    assert.equal(hostStatus, 403);
    assert.equal((await fetch(origin + "/api/install", { method: "POST", headers: { ...headers, Origin: "https://evil.example" }, body: "{}" })).status, 403);
    const result = await fetch(origin + "/api/install", { method: "POST", headers, body: JSON.stringify({ token, agents: ["codex"] }) });
    assert.equal(result.status, 200); const data = await result.json(); assert.equal(data.toolCount, 6); assert(!JSON.stringify(data).includes(token));
    const state = await fetch(origin + "/api/state", { headers }); assert(!(await state.text()).includes(token));
    assert.equal((await fetch(origin + "/api/install", { method: "POST", headers, body: "{bad" })).status, 400);
    assert.equal((await fetch(origin + "/api/install", { method: "POST", headers, body: JSON.stringify({ token: "x".repeat(9000), agents: ["codex"] }) })).status, 413);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}));

test("simultaneous setup requests do not interleave writes; close shuts down the local server", async () => {
  let release;
  await fixture(async ({ setup }) => {
    const { server, url, origin } = await startSetupServer(setup);
    const headers = { "X-Mybox-Setup": new URL(url).hash.slice(1), Origin: origin, "Content-Type": "application/json" };
    const first = fetch(origin + "/api/install", { method: "POST", headers, body: JSON.stringify({ token, agents: ["codex"] }) });
    try {
      while (!release) await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal((await fetch(origin + "/api/install", { method: "POST", headers, body: "{}" })).status, 409);
      release(Response.json({ usedSize: 1 }));
      assert.equal((await first).status, 200);
      const closed = new Promise(resolve => server.once("close", resolve));
      assert.equal((await fetch(origin + "/api/close", { method: "POST", headers, body: "{}" })).status, 200);
      await closed;
    } finally { release?.(Response.json({})); await first.catch(() => {}); server.closeAllConnections(); server.close(); }
  }, { transport: () => new Promise(resolve => { release = resolve; }) });
});
