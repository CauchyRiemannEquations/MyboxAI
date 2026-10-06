import { spawn } from "node:child_process";
import { readFile, lstat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { createSetup, SetupError } from "./core.mjs";
import { startSetupServer } from "./web.mjs";

export function promptSecret(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !input.setRawMode) throw new SetupError("숨김 입력에는 터미널이 필요합니다. --token-file 옵션을 사용하세요.");
  output.write("MYBOX PAT (표시되지 않음, Enter: 기존 토큰 사용): ");
  return new Promise((resolve, reject) => {
    let value = "";
    const raw = !!input.isRaw;
    const wasPaused = input.isPaused();
    const finish = error => {
      input.off("data", onData); input.setRawMode(raw);
      if (wasPaused) input.pause();
      output.write("\n");
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003" || char === "\u0004") return finish(new SetupError("설치를 취소했습니다."));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " " && char <= "~" && value.length < 4096) value += char;
      }
    };
    input.setRawMode(true); input.resume(); input.on("data", onData);
  });
}

function openBrowser(url) {
  let command, args;
  if (process.platform === "win32") {
    // Fixed generated loopback URL; no user input is interpolated into PowerShell.
    command = "powershell.exe"; args = ["-NoProfile", "-Command", `Start-Process '${url}' -WindowStyle Hidden`];
  } else { command = process.platform === "darwin" ? "open" : "xdg-open"; args = [url]; }
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => console.log("브라우저에서 위 주소를 열어 주세요.")); child.unref();
}

export async function main(args, setup = createSetup()) {
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  try {
    if (args.includes("--doctor")) { console.log((await setup.doctor()).message); return; }
    if (args.includes("--cli")) {
      console.log("토큰 발급: https://mybox.naver.com/main/web/preferences");
      console.log("계정 및 개인 액세스 토큰 관리 → 개인 액세스 토큰 생성 → 유효기간 30/60/90/180일 선택 → 생성된 토큰 복사");
      console.log("네이버 화면의 만료일을 확인하세요. 토큰은 생성 시 한 번만 표시되며, 만료 전에 새 토큰으로 다시 연결해야 합니다.");
      let agents = option("--agents")?.split(",").filter(Boolean);
      const yes = args.includes("--yes");
      if (yes && !agents?.length) throw new SetupError("--yes를 사용할 때는 --agents로 연결할 앱을 지정하세요.");
      let rl;
      try {
        if (!agents?.length) {
          rl = createInterface({ input: process.stdin, output: process.stdout });
          console.log("연결할 앱: " + setup.targets.map((target, i) => `${i + 1}. ${target.name}`).join(" / "));
          const answer = await rl.question("앱 번호를 쉼표로 입력하세요 (기본 1): ");
          agents = (answer.trim() || "1").split(",").map(number => setup.targets[Number(number.trim()) - 1]?.id);
          rl.close(); rl = null;
        }
        const changes = await setup.plan(agents);
        console.log("선택한 앱의 mybox 항목을 등록/교체합니다. 다른 항목은 유지하며 기존 파일은 백업합니다.");
        for (const change of changes) console.log(`${change.name}: ${change.file}`);
        console.log(`토큰 저장 위치: ${setup.tokenFile}`);
        let token;
        const source = option("--token-file");
        if (source) {
          const info = await lstat(source);
          if (!info.isFile() || info.size > 4096) throw new SetupError("토큰 파일은 4 KiB 이하의 일반 텍스트 파일이어야 합니다.");
          token = (await readFile(source, "utf8")).trim();
        } else if (!yes) token = await promptSecret();
        if (!yes) {
          rl = createInterface({ input: process.stdin, output: process.stdout });
          const answer = await rl.question("토큰 확인 후 위 위치에 저장하고 앱에 등록할까요? [Y/n]: ");
          if (answer.trim() && !/^(y|yes)$/i.test(answer.trim())) { console.log("설치를 취소했습니다."); return; }
          rl.close(); rl = null;
        }
        const result = await setup.install({ token, agents }, console.log);
        console.log(result.message);
        for (const backup of result.backups) console.log(`설정 백업: ${backup}`);
      } finally { rl?.close(); }
      return;
    }
    if (option("--token-file") || option("--agents") || args.includes("--yes")) throw new SetupError("--agents, --token-file, --yes는 --cli와 함께 사용하세요.");
    const { server, url } = await startSetupServer(setup);
    console.log(`\nMyboxAI 설치 화면: ${url}\n설치 후 화면의 종료 버튼을 누르거나 이 터미널에서 Ctrl+C를 누르세요.`);
    if (!args.includes("--no-open")) openBrowser(url);
    const stop = () => { server.close(); server.closeIdleConnections(); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    server.once("close", () => { process.off("SIGINT", stop); process.off("SIGTERM", stop); });
  } catch (error) {
    console.error(error instanceof SetupError ? error.message : "설치에 실패했습니다. 파일 경로와 쓰기 권한을 확인하세요.");
    process.exitCode = 1;
  }
}
