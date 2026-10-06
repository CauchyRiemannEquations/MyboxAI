#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../mcp/src/network.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const known = new Set(["--cli", "--doctor", "--no-open", "--repair", "--yes", "--agents", "--token-file", "--help", "-h"]);
for (let i = 0; i < args.length; i++) {
  if (!known.has(args[i])) { console.error("알 수 없는 옵션입니다. --help를 확인하세요. 토큰은 명령 인자로 입력하지 마세요."); process.exit(1); }
  if (["--agents", "--token-file"].includes(args[i])) {
    if (!args[++i] || args[i].startsWith("--")) { console.error("옵션 값을 입력하세요."); process.exit(1); }
  }
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(`MyboxAI 설치 도우미 (Node.js 22.13 이상)
  node scripts/setup-mybox.mjs                     브라우저 설치 화면
  node scripts/setup-mybox.mjs --cli               터미널 대화형 설치 (토큰 숨김)
  node scripts/setup-mybox.mjs --doctor            저장 용량 API와 MCP 실행 진단
  node scripts/setup-mybox.mjs --no-open           브라우저 자동 열기 생략
  node scripts/setup-mybox.mjs --repair            의존성을 다시 설치한 뒤 화면 열기
  node scripts/setup-mybox.mjs --cli --agents codex,claude --token-file ./pat.txt --yes
앱: codex, claude, gemini, antigravity, desktop (Windows/macOS)
PAT는 화면/숨김 입력/토큰 파일/MYBOX_TOKEN 환경변수로만 전달하세요.
처음 실행 시 MCP 의존성 설치와 빌드를 자동 수행합니다.`);
  process.exit(0);
}
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) { console.error("Node.js 22.13 이상을 설치하세요: https://nodejs.org/"); process.exit(1); }

async function npm(command) {
  // Launch npm's JS entrypoint directly; Windows npm.cmd and shell quoting are unnecessary.
  const candidates = [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"), path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js")];
  const cli = candidates.find(existsSync);
  const options = { cwd: path.join(root, "mcp"), stdio: "inherit", windowsHide: true };
  await new Promise((resolve, reject) => {
    const child = cli ? spawn(process.execPath, [cli, ...command], options) : spawn("npm", command, { ...options, shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error("npm failed")));
  });
}
try {
  console.log("MyboxAI 설치 도우미를 준비합니다. 처음 실행에는 인터넷 연결이 필요합니다.");
  const stamp = path.join(root, "mcp", "node_modules", ".mybox-setup-state");
  const lock = await readFile(path.join(root, "mcp", "package-lock.json"));
  const fingerprint = `${process.platform}:${process.arch}:${process.versions.modules}:` + createHash("sha256").update(lock).digest("hex");
  const previous = await readFile(stamp, "utf8").catch(() => "");
  // Install on first run, lockfile/runtime change or repair. Use the committed lockfile.
  if (args.includes("--repair") || previous !== fingerprint) {
    await npm(["ci", "--no-audit", "--no-fund"]);
    await writeFile(stamp, fingerprint);
  }
  await npm(["run", "build"]);
  const { main } = await import("../mcp/setup/main.mjs");
  await main(args);
} catch {
  console.error("설치 도우미를 시작하지 못했습니다. 위 메시지와 인터넷 연결·Node.js·폴더 쓰기 권한을 확인하세요.");
  process.exitCode = 1;
}
