const key = location.hash.slice(1) || history.state?.setupKey;
history.replaceState({ setupKey: key }, "", "/");
const $ = id => document.getElementById(id);
let targets = [];
async function api(route, input) {
  const options = { headers: { "X-Mybox-Setup": key } };
  if (input !== undefined) { options.method = "POST"; options.headers["Content-Type"] = "application/json"; options.body = JSON.stringify(input); }
  const response = await fetch(route, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  return result;
}
function status(message, kind = "") { $("status").textContent = message; $("status").className = "status " + kind; }
function selected() { return [...document.querySelectorAll("input[name=agent]:checked")].map(input => input.value); }
function paths() { $("paths").textContent = targets.filter(target => selected().includes(target.id)).map(target => `${target.name}\n${target.file}`).join("\n\n"); }
function disable(value) { document.querySelectorAll("button, input").forEach(element => { element.disabled = value; }); }
async function run(route, input) {
  disable(true); $("result-files").textContent = "";
  status("연결을 확인하고 있습니다. 잠시 기다려 주세요.");
  let running = true;
  const poll = setInterval(() => { api("/api/progress").then(result => { if (running) status(result.progress); }).catch(() => {}); }, 900);
  try {
    const result = await api(route, input);
    running = false;
    status(result.message + `\nMYBOX API 확인 완료 · MCP 도구 ${result.toolCount}개 확인`, "success");
    $("token").value = "";
    if (result.tokenFile) $("result-files").textContent = "토큰 저장: " + result.tokenFile + "\n" + result.configs.map(config => `${config.name}: ${config.file}`).join("\n") + (result.backups.length ? "\n백업:\n" + result.backups.join("\n") : "");
    $("token-help").textContent = "저장된 토큰이 있습니다. 비워 두면 기존 토큰을 사용합니다.";
  } catch (error) { running = false; status(error.message, "error"); }
  finally { running = false; clearInterval(poll); disable(false); }
}
$("setup-form").addEventListener("submit", event => { event.preventDefault(); const agents = selected(); if (!agents.length) return status("연결할 앱을 하나 이상 선택하세요.", "error"); void run("/api/install", { token: $("token").value, agents }); });
$("doctor").addEventListener("click", () => { void run("/api/doctor", {}); });
$("close").addEventListener("click", async () => { try { const result = await api("/api/close", {}); status(result.message); disable(true); } catch (error) { status(error.message, "error"); } });
async function init() {
  try {
    const state = await api("/api/state");
    targets = state.targets;
    for (const target of targets) {
      const label = document.createElement("label"); label.className = "app";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.name = "agent"; checkbox.value = target.id; checkbox.checked = target.id === "codex"; checkbox.addEventListener("change", paths);
      const name = document.createElement("span"); name.textContent = target.name;
      label.append(checkbox, name); $("apps").append(label);
    }
    paths();
    if (state.configured) $("token-help").textContent = "저장된 토큰이 있습니다. 비워 두면 기존 토큰을 사용합니다.";
    status("준비됐습니다. 사용할 앱을 선택하고 연결하기를 누르세요.");
  } catch (error) { status(error.message + " 설치 도우미를 다시 실행해 주세요.", "error"); disable(true); }
}
void init();
