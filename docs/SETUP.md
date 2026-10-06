# MyboxAI 한 번에 연결하기

이 도우미는 PC의 로컬 MCP 설치를 마칩니다. MYBOX PAT 하나를 입력하면 선택한 앱의 등록까지 처리합니다. 별도 OpenAI·Anthropic·Google·Mistral API 키는 받지 않습니다. 사용할 AI 앱은 미리 설치하고 로그인하세요.

## Windows

1. 소스 ZIP을 받아 **계속 보관할 폴더**에 압축을 풉니다. ZIP 안에서 바로 실행하지 마세요.
2. `Setup-MyboxAI.cmd`를 더블클릭합니다.
3. Node.js가 없거나 오래됐으면 Node.js 공식 배포본을 `.mybox-runtime/`에 내려받고 SHA-256 체크섬을 확인합니다. 시스템 설치·관리자 권한·전역 PATH 변경은 하지 않습니다.
4. 잠시 후 열린 브라우저에서 앱을 선택하고 MYBOX PAT를 입력합니다.
5. **선택한 앱에 연결하기**를 누릅니다. 성공 메시지 후 해당 앱을 완전히 종료하고 다시 엽니다.
6. `MYBOX 연결 상태와 저장 용량을 확인해 줘.`라고 요청합니다. 도우미 화면은 종료 버튼으로 닫습니다.

현재 고정된 휴대용 런타임은 Node.js 24.15.0이며 Windows x64 / ARM64를 지원합니다. 첫 실행에는 공식 Node 배포본과 npm 패키지를 받을 인터넷 연결이 필요합니다. Node와 의존성은 이 폴더에 남겨 두세요. 다운로드한 전체 프로그램 폴더를 삭제하면 등록된 MCP도 실행할 수 없습니다.

터미널로 설치하려면:

```powershell
.\Setup-MyboxAI.cmd --cli
```

## macOS / Linux / 이미 Node.js가 있는 Windows

Node.js 22.13 이상에서 저장소 루트로 이동해 실행합니다. Git 대신 ZIP으로 받아도 됩니다.

```bash
# 브라우저 설치 화면
node scripts/setup-mybox.mjs

# macOS / Linux 실행 파일
sh Setup-MyboxAI.command

# 앱 번호 선택, 숨김 토큰 입력, 저장 위치 확인
node scripts/setup-mybox.mjs --cli

# 자동으로 브라우저를 열지 않으려면
node scripts/setup-mybox.mjs --no-open
```

처음에는 `mcp/package-lock.json`을 이용해 의존성을 설치합니다. 다음 실행부터는 잠금 파일이나 Node ABI·OS·CPU가 달라졌을 때 다시 설치하며, MCP는 항상 다시 빌드합니다. 루트의 기존 Sites 웹 앱 패키지는 설치하지 않습니다.

## PAT 발급과 저장

도우미의 **MYBOX 열기** 버튼에서 네이버 계정으로 로그인한 뒤, MYBOX의 개인 액세스 토큰 설정에서 발급하세요. [네이버 공식 안내](https://developers.mybox.naver.com/getting-started)를 확인할 수 있습니다. 로그인과 토큰 발급은 네이버 화면에서 직접 해야 합니다.

PAT는 비밀번호 입력창 또는 CLI의 표시되지 않는 입력으로 받습니다. 브라우저 저장소에는 PAT를 저장하지 않습니다. 서버는 `127.0.0.1`에만 열리고 실행마다 다른 접근 값을 사용합니다. 외부 사이트의 요청·다른 Host·다른 Origin을 거부하며 PAT 응답이나 로그를 만들지 않습니다.

PAT 저장 위치는 `mcp/.mybox-token`입니다. **암호화된 금고가 아니라 로컬 비공개 텍스트 파일**이며 POSIX에서는 소유자 읽기·쓰기 권한으로 저장합니다. Windows의 접근 범위는 해당 사용자 폴더의 NTFS 권한을 따릅니다. 이 파일은 Git에서 제외합니다. 앱 설정에는 PAT 값이 없고 `MYBOX_TOKEN_FILE`의 절대 경로만 들어갑니다. 도우미로 등록한 앱에는 빈 `MYBOX_TOKEN`을 함께 지정하여 셸이나 기존 `.env`의 다른 토큰보다 전용 파일을 우선하게 합니다.

처음 입력을 생략할 경우 기존 `.mybox-token`, 현재 환경변수 `MYBOX_TOKEN` / `MYBOX_TOKEN_FILE`, `mcp/.env` 순서로 찾습니다. 찾은 토큰은 실제 네이버 저장 용량 API로 확인한 후 전용 파일에 저장합니다. 기존 `.env`는 변경하지 않습니다. 새 토큰을 입력하면 전용 파일만 교체하며, 복원을 위해 이전 PAT를 백업 파일로 남기지 않습니다.

## 등록되는 설정 파일

| 앱 | 기본 설정 파일 |
| --- | --- |
| Codex | `~/.codex/config.toml` (`CODEX_HOME`을 지정하면 해당 폴더) |
| Claude Code | `~/.claude.json`의 사용자 범위 `mcpServers` |
| Gemini CLI | `~/.gemini/settings.json` |
| Antigravity | `~/.gemini/config/mcp_config.json` |
| Claude Desktop · Windows | `%APPDATA%/Claude/claude_desktop_config.json` |
| Claude Desktop · macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

**선택한 앱의 `mybox` 항목만 등록/교체**합니다. 다른 MCP 서버와 모델·프로젝트 설정을 유지합니다. JSON의 주석과 후행 쉼표도 지원합니다. TOML은 파서로 기존 설정과 변경 결과를 비교하고 다른 값이 변했으면 저장하지 않습니다. 읽기 제한은 4 MiB이며 심볼릭 링크 설정 파일은 자동 변경하지 않습니다. 비표준 inline/dotted TOML의 mybox 설정은 자동으로 합치지 못할 수 있으므로 일반 `[mcp_servers.mybox]` 구조로 바꾸거나 기존 CLI 명령을 사용하세요.

수정 전 앱 설정을 같은 폴더에 `.mybox-backup-<고유값>`으로 복사합니다. 토큰/API 확인 실패는 파일을 쓰기 전에 중단하고, 저장 뒤 MCP 시작 검증 실패는 해당 실행에서 변경한 설정·PAT를 복원합니다. 중간에 다른 프로그램이 수정한 파일은 덮어쓰지 않고 복원 실패를 알려 줍니다. 설정 백업에는 기존 설정의 비밀 값이 있을 수 있으므로 공개 저장소에 올리지 마세요.

복원하려면 해당 앱을 종료한 뒤 백업 파일을 원래 설정 파일 이름으로 복사하세요. 연결만 제거하려면 앱의 MCP 설정에서 `mybox` 항목을 삭제합니다. 토큰을 폐기하려면 네이버 MYBOX 설정에서 폐기하고 로컬 전용 파일도 삭제하세요.

## 자동화와 진단

```bash
# 여러 앱 자동 등록. PAT 자체를 명령 인자로 넘기지 않습니다.
node scripts/setup-mybox.mjs --cli --agents codex,claude,gemini --token-file ./private/pat.txt --yes

# 기존 토큰을 재사용하는 자동 등록
node scripts/setup-mybox.mjs --cli --agents codex --yes

# 실제 네이버 저장 용량 API + MCP 시작/도구 목록 확인
node scripts/setup-mybox.mjs --doctor

# 의존성 강제 재설치 후 화면 열기
node scripts/setup-mybox.mjs --repair

# 전체 옵션
node scripts/setup-mybox.mjs --help
```

자동화의 `--yes`는 표시된 기본 경로에 토큰을 저장하고 지정한 앱의 mybox 설정을 등록/교체하는 데 동의합니다. `--agents`를 반드시 지정하세요. 앱 ID는 `codex`, `claude`, `gemini`, `antigravity`, `desktop`이며 Linux에서는 `desktop`을 제공하지 않습니다. `--token-file`은 4 KiB 이하 일반 텍스트 파일을 받습니다. 파일은 Git에서 제외하고 토큰을 명령 인자나 채팅에 붙이지 마세요.

진단은 토큰과 앱 설정을 쓰지 않습니다. 도우미 런타임 준비 시 필요한 의존성 설치·빌드는 실행할 수 있습니다. 브라우저의 **기존 연결 진단**도 저장된 토큰을 확인합니다. 아직 저장하지 않은 입력창의 토큰은 **연결하기**로 확인하세요.

## 확인 범위

모의 네이버 응답으로 토큰 확인 → 비공개 저장 → 다섯 앱의 설정 생성/보존 → 실제 표준 MCP SDK를 통한 subprocess 시작 → 도구 6개 확인을 테스트합니다. 한글·공백 경로, 기존 토큰, 토큰 교체, 설정 백업/복원, 잘못된 토큰, API 실패, HTTP 접근 보호, 숨김 입력을 포함합니다. Windows에서 휴대용 Node 다운로드·체크섬·실행과 브라우저 UI도 확인했습니다.

실제 개인 MYBOX PAT를 사용한 파일 접근은 사용자가 토큰을 입력한 뒤 확인합니다. 앱 설정 파일 생성은 검증하지만 각 앱의 모든 버전·계정·실제 모델 화면을 대신 실행하는 것은 아닙니다. 모바일 연결은 별도 원격 HTTPS 서버가 필요하며 이 로컬 도우미가 서버를 호스팅하지 않습니다.

## 공식 설정 문서

- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/)
- [Antigravity MCP](https://antigravity.google/docs/mcp)
