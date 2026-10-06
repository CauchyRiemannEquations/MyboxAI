import { readFile, writeFile, mkdir, lstat, rename, unlink, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { parseEnv, isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseToml } from "smol-toml";
import { parse as parseJson, modify, applyEdits } from "jsonc-parser";
import { MyboxClient, AppError } from "../dist/core.mjs";
import { loadToken, LOCAL_TOOL_NAMES } from "../dist/server.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export class SetupError extends Error {}
const object = value => value && typeof value === "object" && !Array.isArray(value);

// Configs may contain other credentials. Never include their contents or parser errors in output.
async function snapshot(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new SetupError(`설정 파일이 일반 파일인지 확인하세요: ${file}`);
    return { text: await readFile(file, "utf8"), mode: info.mode & 0o777 };
  } catch (error) {
    if (error.code === "ENOENT") return { text: null, mode: 0o600 };
    if (error instanceof SetupError) throw error;
    throw new SetupError(`설정 파일을 읽을 수 없습니다: ${file}`);
  }
}

function mergeJson(text, entry) {
  const errors = [];
  const bom = text?.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = (text ?? "{}\n").replace(/^\uFEFF/, "");
  const config = parseJson(source, errors, { allowTrailingComma: true });
  if (errors.length || !object(config) || (config.mcpServers !== undefined && !object(config.mcpServers))) {
    throw new SetupError("JSON 설정 형식이 올바르지 않습니다. 기존 파일을 고친 뒤 다시 실행하세요.");
  }
  const next = applyEdits(source, modify(source, ["mcpServers", "mybox"], entry, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } }));
  const expected = structuredClone(config);
  expected.mcpServers ??= {};
  expected.mcpServers.mybox = entry;
  const afterErrors = [];
  const after = parseJson(next, afterErrors, { allowTrailingComma: true });
  if (afterErrors.length || !isDeepStrictEqual(after, expected)) throw new SetupError("JSON 설정을 안전하게 합칠 수 없습니다. 중복된 mcpServers/mybox 항목을 확인하세요.");
  return bom + next;
}

function mergeToml(text, entry) {
  const source = (text ?? "").replace(/^\uFEFF/, "");
  let before;
  try { before = parseToml(source); } catch { throw new SetupError("Codex TOML 설정이 올바르지 않습니다. 기존 파일을 확인하세요."); }
  // Preserve comments and every unrelated section. Refuse alternate inline/dotted forms
  // unless semantic verification confirms the edit changes only mcp_servers.mybox.
  let skip = false;
  const kept = source.split(/\r?\n/).filter(line => {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (header) skip = /^mcp_servers\s*\.\s*(?:mybox|"mybox"|'mybox')(?:\s*\.|\s*$)/.test(header[1].trim());
    return !skip;
  }).join("\n");
  const generated = `\n[mcp_servers.mybox]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\nstartup_timeout_sec = 20\ntool_timeout_sec = 180\n\n[mcp_servers.mybox.env]\nMYBOX_TOKEN = ""\nMYBOX_TOKEN_FILE = ${JSON.stringify(entry.env.MYBOX_TOKEN_FILE)}\n`;
  const result = kept.trimEnd() + "\n" + generated;
  try {
    const after = parseToml(result);
    const expected = structuredClone(before);
    expected.mcp_servers ??= {};
    expected.mcp_servers.mybox = { command: entry.command, args: entry.args, startup_timeout_sec: 20, tool_timeout_sec: 180, env: entry.env };
    // smol-toml uses null-prototype maps; compare normalized trees (including Dates).
    if (!isDeepStrictEqual(structuredClone(after), expected)) throw new Error();
  } catch { throw new SetupError("Codex 설정을 안전하게 합칠 수 없습니다. mybox 설정을 일반 [mcp_servers.mybox] 표로 정리하거나 CLI로 등록하세요."); }
  return result;
}

async function atomicWrite(file, text, mode) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.mybox-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { flag: "wx", mode });
    await chmod(temporary, mode);
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => {}); }
}

export async function smokeServer(entry) {
  // Use exactly the command, args and credential source installed in the clients.
  const transport = new StdioClientTransport({ command: entry.command, args: entry.args, env: { ...process.env, ...entry.env }, stderr: "pipe" });
  const client = new Client({ name: "mybox-setup", version: "1.0" });
  // stderr may contain private data from dependencies. Consume it without logging.
  const consume = () => transport.stderr?.resume();
  const timer = setTimeout(() => { void client.close().catch(() => {}); void transport.close().catch(() => {}); }, 20_000);
  try {
    const connection = client.connect(transport); consume(); await connection;
    const { tools } = await client.listTools();
    const status = await client.callTool({ name: "get_connection_status", arguments: {} });
    const block = status.content?.find(item => item.type === "text");
    const configured = block && JSON.parse(block.text);
    const expected = configured?.read_only ? LOCAL_TOOL_NAMES.slice(0, 6) : LOCAL_TOOL_NAMES;
    if (status.isError || !configured?.configured || expected.some(name => !tools.some(tool => tool.name === name))) throw new Error();
    return tools.length;
  } catch { throw new SetupError("MCP 실행 검증에 실패했습니다. Node.js와 설치 폴더를 확인하세요."); }
  finally { clearTimeout(timer); await client.close().catch(() => {}); await transport.close().catch(() => {}); }
}

export function createSetup({ root = fileURLToPath(new URL("../../", import.meta.url)), home = homedir(), env = process.env, platform = process.platform, transport = fetch, smoke = smokeServer } = {}) {
  root = path.resolve(root);
  const tokenFile = path.join(root, "mcp", ".mybox-token");
  const entry = { command: process.execPath, args: [path.join(root, "mcp", "dist", "server.mjs")], env: { MYBOX_TOKEN: "", MYBOX_TOKEN_FILE: tokenFile } };
  const targets = [
    { id: "codex", name: "Codex", file: path.join(env.CODEX_HOME || path.join(home, ".codex"), "config.toml"), type: "toml" },
    { id: "claude", name: "Claude Code", file: path.join(home, ".claude.json"), type: "json" },
    { id: "gemini", name: "Gemini CLI", file: path.join(home, ".gemini", "settings.json"), type: "json" },
    { id: "antigravity", name: "Antigravity", file: path.join(home, ".gemini", "config", "mcp_config.json"), type: "json" },
  ];
  if (platform === "win32" || platform === "darwin") targets.push({ id: "desktop", name: "Claude Desktop", file: platform === "win32" ? path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json") : path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), type: "json" });

  async function existingToken() {
    // The installer explicitly selects its private file, independent of stale shell/.env tokens.
    const saved = await snapshot(tokenFile);
    if (saved.text !== null) return loadToken({ MYBOX_TOKEN: saved.text });
    if (env.MYBOX_TOKEN?.trim() || env.MYBOX_TOKEN_FILE) return loadToken(env);
    const file = await snapshot(path.join(root, "mcp", ".env"));
    try { return file.text === null ? null : loadToken(parseEnv(file.text)); }
    catch { throw new SetupError("기존 MYBOX 토큰 설정을 확인하거나 새 토큰을 입력하세요."); }
  }
  async function getToken(value) {
    try {
      const token = await loadToken({ MYBOX_TOKEN: value || await existingToken() });
      if (!token) throw new Error();
      return token;
    } catch { throw new SetupError("MYBOX 개인 액세스 토큰을 입력하세요. mbx_pat_로 시작하는 발급받은 전체 토큰이 필요합니다."); }
  }
  async function verifyToken(token) {
    try { await new MyboxClient(token, transport).storage(); }
    catch (error) { throw new SetupError(error instanceof AppError ? error.message : "MYBOX에 연결할 수 없습니다. 네트워크와 토큰을 확인하세요."); }
  }
  async function state() {
    let configured = false;
    try { configured = !!await existingToken(); } catch {}
    return { root, node: process.version, tokenFile, configured, targets: await Promise.all(targets.map(async target => ({ ...target, exists: (await snapshot(target.file)).text !== null }))) };
  }
  async function plan(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.some(id => !targets.some(target => target.id === id))) throw new SetupError("연결할 앱을 하나 이상 선택하세요.");
    return Promise.all([...new Set(ids)].map(async id => {
      const target = targets.find(value => value.id === id);
      const previous = await snapshot(target.file);
      const configEntry = id === "gemini" ? { ...entry, timeout: 180000 } : id === "claude" ? { ...entry, type: "stdio" } : entry;
      return { ...target, previous, next: target.type === "toml" ? mergeToml(previous.text, entry) : mergeJson(previous.text, configEntry) };
    }));
  }
  async function install({ token: value, agents } = {}, onProgress = () => {}) {
    const changes = await plan(agents); // Reject malformed configs before any credential write/API call.
    const token = await getToken(value);
    onProgress("MYBOX 토큰으로 저장 용량 API를 확인하고 있습니다.");
    await verifyToken(token);
    const previousToken = await snapshot(tokenFile);
    const writes = [{ file: tokenFile, previous: previousToken, next: token + "\n", private: true }, ...changes];
    const committed = [], backups = [];
    try {
      for (const change of writes) {
        const current = await snapshot(change.file);
        if (current.text !== change.previous.text) throw new SetupError("설정 파일이 다른 프로그램에서 변경되었습니다. 다시 실행하세요.");
        if (!change.private && current.text !== null && current.text !== change.next) {
          const backup = `${change.file}.mybox-backup-${randomUUID()}`;
          await writeFile(backup, current.text, { flag: "wx", mode: 0o600 });
          backups.push(backup);
        }
        await atomicWrite(change.file, change.next, change.private ? 0o600 : current.mode);
        committed.push(change);
      }
      onProgress("설정을 저장했습니다. MCP 서버의 시작과 도구 목록을 확인하고 있습니다.");
      const toolCount = await smoke(entry);
      return { ok: true, apiVerified: true, toolCount, tokenFile, configs: changes.map(({ id, name, file }) => ({ id, name, file })), backups, message: "설치 완료! 선택한 앱을 완전히 종료한 뒤 다시 열어 주세요. MYBOX 연결 상태와 저장 용량을 확인해 달라고 요청하세요." };
    } catch (error) {
      let rollbackFailed = false;
      for (const change of committed.reverse()) {
        try {
          // Do not overwrite a concurrent edit made after our write.
          if ((await snapshot(change.file)).text !== change.next) { rollbackFailed = true; continue; }
          if (change.previous.text === null) await unlink(change.file);
          else await atomicWrite(change.file, change.previous.text, change.previous.mode);
        } catch { rollbackFailed = true; }
      }
      if (rollbackFailed) throw new SetupError("설치 실패 후 일부 설정을 복원하지 못했습니다. 설정 파일과 .mybox-backup 파일을 확인하세요.");
      throw new SetupError(error instanceof SetupError ? error.message : "설정을 저장하지 못했습니다. 폴더 쓰기 권한을 확인하세요.");
    }
  }
  async function doctor() {
    const token = await getToken();
    await verifyToken(token);
    // Diagnosis uses an existing credential without persisting or registering anything.
    const toolCount = await smoke({ ...entry, env: { MYBOX_TOKEN: token, MYBOX_TOKEN_FILE: "" } });
    return { ok: true, apiVerified: true, toolCount, message: `MYBOX API 연결과 MCP 도구 ${toolCount}개를 확인했습니다.` };
  }
  return { state, plan, install, doctor, targets, tokenFile };
}
