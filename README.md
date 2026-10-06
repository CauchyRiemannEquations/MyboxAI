# MyboxAI

네이버 MYBOX 파일을 **Codex, Claude Code, Antigravity, Gemini CLI와 MCP를 지원하는 AI 앱**에서 검색하고 읽는 프로젝트입니다.

**스캔 PDF와 사진은 원문 이미지를 현재 에이전트에 전달합니다. GPT를 쓰면 GPT가, Claude를 쓰면 Claude가, Gemini를 쓰면 Gemini가 직접 읽습니다.**

MYBOX는 네이버의 개인 파일 저장 서비스입니다. 네이버 클라우드 플랫폼(NCP)용 관리 도구와는 다릅니다. 네이버·OpenAI·Anthropic·Google의 공식 제품이 아닌 개인 프로젝트입니다.

## 어떤 방식으로 쓰나요?

| 방식 | 실행 위치 | 용도 | 준비물 |
| --- | --- | --- | --- |
| 로컬 MCP · 권장 시작점 | 내 PC, 에이전트가 자동 실행 | Codex, Claude Code, Antigravity, Gemini CLI, Claude Desktop의 로컬 MCP | Node.js, MYBOX PAT |
| 원격 MCP | 직접 운영하는 HTTPS 서버 | ChatGPT·Claude·Gemini 앱의 원격 연결, 모바일 사용 | 서버, MYBOX PAT, 서버 연결 암호 |
| 기존 ChatGPT Site | ChatGPT Sites | ChatGPT 전용 파일 연결 화면과 기존 웹 MCP | 별도 Sites 배포·저장소·인증 설정 |

GitHub 저장소를 만들거나 로컬 MCP를 등록하는 것만으로 원격 서버가 생기지는 않습니다. **모바일 앱은 PC의 로컬 MCP를 직접 실행할 수 없습니다.** 원격 방식은 아래의 서버 배포 과정이 추가로 필요합니다.

## 지원 기능과 제한

- 파일 이름·확장자·종류 검색, 폴더 조회, 파일 정보, 저장 용량 조회
- PDF 본문 추출, 스캔 페이지 이미지 반환, 수학·도형 원문 보기, 부분 확대
- HWP 5 / HWPX / DOCX 본문 추출, 큰 텍스트의 구간 읽기
- PNG / JPEG / WEBP를 모델이 읽을 수 있는 JPEG 이미지로 전달
- MYBOX 파일을 변경하거나 삭제하는 도구는 제공하지 않음

| 형식 | 파일 크기 | 읽는 방식 |
| --- | --- | --- |
| PDF | 100 MiB | 선택 쪽의 텍스트 또는 이미지 |
| HWP 5, HWPX, DOCX | 50 MiB | 본문. 삽입 그림과 원문 배치가 필요하면 PDF로 변환 |
| TXT, MD, CSV, JSON, LOG, TSV, XML, YAML | 50 MiB | 512 KiB 구간을 이어 읽기 |
| PNG, JPEG, WEBP | 20 MiB | 이미지. 입력 사진은 최대 약 16MP |

이미지는 한 번에 최대 3쪽, 텍스트 PDF는 최대 25쪽입니다. 기본 이미지 긴 변은 1800px이며 800~3000px로 지정할 수 있습니다. 이미지마다 JPEG 결과는 최대 2 MiB입니다. 큰 파일을 모델에 통째로 넣지 않고, 선택한 쪽이나 구간만 반환합니다.

서버가 사진의 글자를 OCR 텍스트로 완성하는 것은 아닙니다. **이미지를 받은 모델이 직접 인식**합니다. 사용하는 앱·모델이 이미지 도구 결과를 지원해야 하며, 해당 에이전트의 이용 한도·이미지 입력 비용은 적용될 수 있습니다.

## 한 번에 연결하기 · 추천

**Windows는 `Setup-MyboxAI.cmd`를 더블클릭하세요.** GitHub의 **Code → Download ZIP**으로 받아 압축을 풀어도 됩니다. Git이나 별도 웹 앱 설치가 필요 없습니다. Node.js가 없다면 공식 배포본을 설치 폴더에 자동으로 받아 실행하며, 관리자 권한과 시스템 PATH 변경이 필요 없습니다. 처음에는 인터넷 연결이 필요합니다.

1. 열린 한국어 화면에서 Codex / Claude Code / Gemini CLI / Antigravity / Claude Desktop 중 사용할 앱을 선택합니다. 여러 앱을 함께 고를 수 있습니다.
2. **MYBOX 환경설정 열기**로 [환경설정](https://mybox.naver.com/main/web/preferences)에 접속하고 **계정 및 개인 액세스 토큰 관리 → 개인 액세스 토큰 생성**을 선택합니다. 이름과 **유효기간 30일·60일·90일·180일**을 확인한 뒤 발급한 **개인 액세스 토큰(PAT)**을 도우미에 입력합니다. 토큰은 생성할 때 한 번만 표시되므로 바로 복사하세요. 토큰 발급과 네이버 로그인은 사용자가 MYBOX에서 직접 합니다.
3. **선택한 앱에 연결하기**를 누릅니다. 도우미가 실제 저장 용량 API로 토큰을 확인하고, 토큰 저장 → 기존 설정 백업 → 앱 등록 → MCP 실행 검증을 처리합니다.
4. 선택한 앱을 완전히 종료한 뒤 다시 열고 `MYBOX 저장 용량을 확인해 줘.`라고 요청합니다. 완료 후 도우미의 종료 버튼을 누릅니다.

macOS는 Node.js 22.13 이상 설치 후 `sh Setup-MyboxAI.command`로 실행합니다. macOS / Linux / Windows 공통으로 아래 명령도 사용할 수 있습니다. **저장소 루트**에서 실행하며 루트 웹 앱의 의존성은 설치하지 않습니다.

```bash
node scripts/setup-mybox.mjs
```

### 터미널에서 한 번에 설정

```bash
node scripts/setup-mybox.mjs --cli
```

앱 번호 선택 → 화면에 표시되지 않는 PAT 입력 → 저장 위치 확인 순서로 진행합니다. 토큰이 이미 설정되어 있으면 입력 없이 Enter로 재사용할 수 있습니다. Windows에서 Node.js가 없다면 `Setup-MyboxAI.cmd --cli`로 동일하게 진행하세요.

```bash
# 저장된 토큰으로 API와 MCP 실행 진단
node scripts/setup-mybox.mjs --doctor

# 사용할 앱과 비공개 토큰 파일을 지정하는 자동 설치
node scripts/setup-mybox.mjs --cli --agents codex,claude --token-file ./pat.txt --yes

# 설치 파일이 손상됐을 때 의존성 다시 설치
node scripts/setup-mybox.mjs --repair
```

`--yes`는 지정한 앱의 **mybox 항목 등록/교체와 로컬 토큰 저장에 동의**하는 옵션입니다. 기존 토큰이나 `MYBOX_TOKEN` 환경변수를 사용할 수도 있습니다. PAT 자체를 명령 인자로 붙이지 마세요. 토큰 파일은 Git에서 제외한 위치에 보관하세요.

도우미는 PAT를 Git에서 제외한 `mcp/.mybox-token`에 저장합니다. 앱 설정에는 토큰 값 대신 이 파일의 경로와 Node.js·서버 절대 경로만 넣습니다. 기존 `.env`를 보존하며, 도우미로 등록한 앱에는 이 전용 토큰 파일을 우선 사용하도록 설정합니다. 이전 토큰을 계속 사용하려면 화면을 비워 두고, 교체하려면 새 토큰을 입력하세요.

기존 앱 설정의 다른 서버·모델·프로젝트 설정과 주석은 유지하며, 변경 전 파일은 옆에 `.mybox-backup-...` 이름으로 백업합니다. 설정 형식이 잘못되어 있으면 저장 전에 중단합니다. MCP 실행 검증이 실패하면 토큰과 설정을 복원합니다. 앱 자체의 설치·로그인과 모바일용 HTTPS 서버 배포는 별도입니다. **설치 후 이 폴더를 이동·삭제하면 연결이 끊기므로 계속 둘 위치에 먼저 압축을 풀어 주세요.**

자세한 사용법과 복원 방법은 [docs/SETUP.md](docs/SETUP.md)를 확인하세요. 수동으로 등록하려면 아래 절차를 사용할 수 있습니다.

## 1. 수동 설치

[Node.js](https://nodejs.org/) 22.13 이상과 Git을 설치합니다. 아래 명령은 처음 설치할 때 한 번 실행합니다.

```bash
git clone https://github.com/CauchyRiemannEquations/MyboxAI.git
cd MyboxAI/mcp
npm ci
npm run build
```

로컬 MCP만 쓸 때는 저장소 루트의 웹 앱 의존성을 설치하지 않아도 됩니다.

업데이트할 때는 같은 폴더에서 `git pull`, `npm ci`, `npm run build`를 실행하고 에이전트를 다시 시작합니다.

## 2. MYBOX 토큰 설정

1. MYBOX 웹에 네이버 계정으로 로그인합니다.
2. [환경설정](https://mybox.naver.com/main/web/preferences)에서 **계정 및 개인 액세스 토큰 관리 → 개인 액세스 토큰 생성**을 선택합니다. **유효기간 30일·60일·90일·180일**과 화면의 만료일을 확인하고 발급하세요. 토큰은 생성할 때 한 번만 표시됩니다. 만료 전에 새 토큰을 발급해 교체하세요.
3. `mcp/.env.example`을 `mcp/.env`로 복사합니다.
4. `.env`를 편집기로 열어 `MYBOX_TOKEN=` 뒤에 토큰을 넣고 저장합니다.

macOS / Linux:

```bash
cp .env.example .env
chmod 600 .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

`.env` 내용:

```dotenv
MYBOX_TOKEN=여기에_MYBOX에서_발급한_토큰
```

네이버 로그인은 MYBOX 웹 이용을 위한 것이고, PAT는 이 프로그램의 API 접근을 위한 것입니다. MYBOX 화면의 `curl -H ... /v1/drive/storage` 예시는 터미널에서 저장 용량을 조회하는 **API 테스트 명령**입니다. 그 명령 자체가 MCP 서버는 아닙니다.

토큰은 채팅·README·GitHub에 붙여넣지 마세요. `.env`는 Git에서 제외합니다. 이미 설정한 환경변수 `MYBOX_TOKEN`이 있으면 `.env` 값보다 우선합니다. 토큰만 들어 있는 별도 파일을 사용하려면 환경변수 `MYBOX_TOKEN_FILE`에 그 파일 경로를 지정할 수도 있습니다.

## 3. 에이전트에 등록

공통 실행 프로그램은 `MyboxAI/mcp/dist/server.mjs`입니다. 아래의 `/absolute/path`를 **설치한 폴더의 실제 절대 경로**로 바꾸세요.

macOS 예: `/Users/me/projects/MyboxAI/mcp/dist/server.mjs`
Windows JSON 예: `C:/Users/me/projects/MyboxAI/mcp/dist/server.mjs`

한 번 등록하면 에이전트가 프로그램을 실행합니다. 매번 `curl`을 입력하거나 별도 터미널에 서버를 켜 둘 필요가 없습니다.

### Codex

CLI로 등록:

```bash
codex mcp add mybox -- node /absolute/path/MyboxAI/mcp/dist/server.mjs
codex mcp list
```

또는 `~/.codex/config.toml`의 기존 설정을 유지하면서 추가합니다.

```toml
[mcp_servers.mybox]
command = "node"
args = ["/absolute/path/MyboxAI/mcp/dist/server.mjs"]
startup_timeout_sec = 20
tool_timeout_sec = 180
```

Codex를 다시 시작하고 `/mcp`에서 연결 상태를 확인하세요. Codex CLI·IDE의 MCP 설정 예시이며, ChatGPT 모바일 연결은 아래 원격 방식이 필요합니다.

### Claude Code

```bash
claude mcp add --transport stdio --scope user mybox -- node /absolute/path/MyboxAI/mcp/dist/server.mjs
claude mcp get mybox
```

Claude Code를 다시 시작하고 `/mcp`에서 확인하세요. 큰 파일에서 시간 초과가 나면 Claude Code를 실행하는 환경의 `MCP_TOOL_TIMEOUT`을 `180000`으로 설정할 수 있습니다.

프로젝트용 `.mcp.json`에는 다음 구조로 기존 서버 목록과 합쳐 넣습니다. 프로젝트 설정을 처음 사용할 때 Claude Code가 승인을 요청할 수 있습니다.

```json
{
  "mcpServers": {
    "mybox": {
      "command": "node",
      "args": ["/absolute/path/MyboxAI/mcp/dist/server.mjs"]
    }
  }
}
```

Claude Desktop의 **로컬 MCP** 설정에도 같은 `mcpServers` 구조를 사용합니다. Desktop의 설정에서 MCP 설정 파일을 열어 편집하세요. 이 로컬 설정은 Claude 모바일로 동기화되는 원격 커넥터와 별개의 기능입니다.

### Google Antigravity

IDE의 에이전트 패널에서 **MCP Servers → Manage MCP Servers → View raw config**를 열고 위 JSON을 기존 설정과 합칩니다. 현재 공식 문서의 전역 경로는 `~/.gemini/config/mcp_config.json`, 프로젝트 경로는 `.agents/mcp_config.json`입니다. 제품·버전에 따라 실제 설정 화면을 우선하세요.

`command`와 `args`를 사용하는 로컬 stdio 서버로 등록하고 서버 목록을 새로고침합니다. 복사용 예시는 [mcp/examples/antigravity.json](mcp/examples/antigravity.json)에 있습니다.

### Gemini CLI

`~/.gemini/settings.json`의 `mcpServers`에 추가합니다.

```json
{
  "mcpServers": {
    "mybox": {
      "command": "node",
      "args": ["/absolute/path/MyboxAI/mcp/dist/server.mjs"],
      "timeout": 180000
    }
  }
}
```

Gemini CLI를 다시 시작합니다. Gemini 일반 앱의 Connected Apps는 이 로컬 설정을 읽지 않습니다.

다른 MCP 클라이언트도 **stdio 실행 명령 + 인자**를 등록하는 방식으로 연결할 수 있습니다. 모든 제품·버전을 실제로 실행해서 검증한 것은 아닙니다. 아래 검증 범위를 확인하세요.

## 4. 이렇게 요청하세요

```text
MYBOX 연결 상태와 저장 용량을 확인해 줘.
MYBOX에서 이름에 '미분'이 들어가는 PDF를 찾아 줘.
첫 번째 결과의 1~3쪽을 읽고 수업용 핵심 개념을 정리해 줘.
그 PDF의 2쪽을 원문 이미지로 보고, 수식과 도형을 확인해서 풀어 줘.
사진 속 글자를 직접 읽고 수식을 LaTeX로 정리해 줘.
문제의 오른쪽 아래 부분을 확대해서 숫자를 다시 확인해 줘.
```

처음에는 `get_connection_status` 다음에 `get_storage_info`로 토큰의 실제 API 유효성을 확인합니다. 상태의 `configured=true`는 토큰 설정 여부이고, 유효성 검증 결과는 아닙니다.

### 읽기 옵션

| `mode` | 동작 |
| --- | --- |
| `auto` · 기본 | 본문 추출. 텍스트가 적은 PDF 쪽은 이미지로 함께 반환. 사진은 이미지로 반환 |
| `text` | 텍스트만 추출. 스캔에 텍스트 층이 없으면 글자가 나오지 않음 |
| `vision` | 선택한 모든 PDF 쪽이나 사진을 이미지로 반환. 수식·도형·표 확인에 적합 |

스캔 여부는 텍스트 양을 이용한 휴리스틱입니다. OCR 텍스트가 이미 들어 있거나 도형이 많은 문서는 `mode=vision`을 명시하는 편이 좋습니다.

도구 호출 예:

```json
{
  "id": "검색_결과의_실제_id",
  "mode": "vision",
  "start_page": 2,
  "page_count": 1,
  "width": 2400,
  "crop": { "x": 0.5, "y": 0.5, "width": 0.5, "height": 0.5 }
}
```

`crop`은 왼쪽·위쪽·폭·높이를 0~1 비율로 지정합니다. 위 예시는 오른쪽 아래 1/4 영역입니다. `crop`은 `vision` 모드에서 사용합니다.

`next_offset`은 **같은 쪽·구간**의 남은 본문, `next_start_page`는 다음 PDF 쪽, `next_start_byte`는 다음 텍스트 구간입니다. 쪽이나 바이트 구간을 바꿀 때 `offset`을 0으로 초기화하세요. 이미지가 함께 있는 본문을 이어 읽으면 같은 이미지가 다시 반환될 수 있습니다.

### 이미지를 표시하지 못하는 로컬 클라이언트

해당 클라이언트가 로컬 이미지 파일을 읽을 수 있다면 `.env`에 전용 폴더를 추가합니다.

```dotenv
MYBOX_IMAGE_DIR=/absolute/path/to/mybox-images
```

이미지 content와 함께 `image_pages[].local_path`가 반환됩니다. 에이전트에게 그 경로의 이미지를 열도록 요청하세요. **이 옵션의 이미지 파일은 자동 삭제되지 않습니다.** 필요 없어진 파일은 직접 정리하세요. 원격 모바일 연결에는 PC 파일 경로를 읽는 이 대체 방식이 적용되지 않습니다.

## 원격 MCP: ChatGPT·Claude·Gemini 앱과 모바일

코드는 **Streamable HTTP + OAuth 2.1 / PKCE + 동적 클라이언트 등록**을 제공합니다. URL 하나를 등록하고 서버 연결 암호로 승인하면 같은 파일 도구를 사용할 수 있습니다. 모델 이미지 읽기는 로컬과 같은 구현입니다.

**이 저장소의 원격 Node 서버는 별도로 배포해야 합니다. 이 README의 예시 도메인은 실제 서비스 주소가 아닙니다.** 코드를 공개한 것만으로 모바일 연결이나 호스팅이 활성화되지는 않습니다.

### 서버 실행

1. `mcp/.env.http.example`을 `mcp/.env`로 복사합니다.
2. `MYBOX_TOKEN`, `MCP_PUBLIC_URL`, `MCP_OWNER_SECRET`을 설정합니다.
3. `MCP_PUBLIC_URL`에는 외부 HTTPS 도메인만 넣습니다. 예: `https://mybox.example.com`.
4. HTTPS 리버스 프록시 뒤에서 `npm run start:http`를 실행합니다. 프록시는 외부 도메인의 Host 헤더를 유지하고 MCP POST 응답을 전달해야 합니다.
5. 앱에 등록할 주소는 `https://mybox.example.com/mcp`입니다.

서버 연결 암호 생성 예:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

생성한 값을 `.env`의 `MCP_OWNER_SECRET`에 넣습니다. 이 값은 **MYBOX PAT와 다른 로그인 보호용 암호**입니다. 외부 OCR 서비스 키가 아닙니다. MYBOX PAT는 서버에만 설정합니다.

Docker를 사용한다면 **저장소 루트**에서:

```bash
docker build -f mcp/Dockerfile -t mybox-ai .
docker run --rm --env-file mcp/.env -e HOST=0.0.0.0 -p 127.0.0.1:3001:3001 mybox-ai
```

외부 HTTPS는 별도 프록시/호스팅에서 제공합니다. Docker 이미지에는 한글 폰트가 포함됩니다. Docker 빌드는 이 작업 환경에서 실행하지 않았으며, Node 서버와 OAuth 흐름은 통합 테스트로 검증했습니다.

이 원격 서버는 **한 명의 MYBOX 계정용**입니다. 승인한 앱은 모두 같은 서버 소유자의 파일에 접근합니다. 여러 사용자의 MYBOX를 분리하는 서비스용 회원가입 서버는 구현하지 않았습니다. OAuth 등록과 인증 토큰은 메모리에 저장되어 서버 재시작 시 다시 연결해야 합니다. 단일 프로세스로 실행하세요. `/health`는 토큰을 반환하지 않는 상태 확인 경로입니다.

### 앱별 연결 조건 · 2026-10-05 공식 문서 기준

| 앱 | 연결 경로 | 모바일 및 조건 |
| --- | --- | --- |
| ChatGPT | 원격 MCP/플러그인 등록 화면에 HTTPS `/mcp` URL 추가, OAuth 승인 | 계정에 사용 가능한 원격 플러그인은 웹·모바일에서 사용 가능. Desktop only 플러그인은 제외. 직접 등록 메뉴와 배포 권한은 계정·워크스페이스에 따라 다름 |
| Claude | Customize → Connectors → Add custom connector, HTTPS URL 등록 | 원격 커넥터는 모바일에서도 사용 가능. 연결은 Anthropic 서버에서 이루어지므로 공개 HTTPS 필요. 모바일 설치는 베타이므로 웹에서 먼저 등록 권장 |
| Gemini 일반 앱 | 웹 Settings → Connected Apps → Add custom app, HTTPS URL 등록 | 연결 후 모바일 사용 가능. 현재 미국·18세 이상·개인 계정·영어·Keep Activity 켜짐 조건. 한국에서 바로 사용할 수 있다고 보장하지 않음 |
| 기타 AI 앱 | 앱의 MCP 설정 | 원격 HTTP/OAuth와 이미지 결과 지원 여부를 확인해야 함 |

이 표는 각 회사의 MCP 연결 기능에 대한 문서 확인 결과입니다. MyboxAI를 각 앱의 실제 계정에서 연결·스캔 인식까지 실행해 검증한 결과는 아닙니다. 플러그인 마켓에 공개 등록하거나 제품 측 제한을 바꾸는 작업도 포함하지 않습니다.

## 자주 겪는 문제

| 증상 | 확인할 내용 |
| --- | --- |
| `node`를 찾을 수 없음 | Node 설치 후 앱 재시작. GUI 앱에서 PATH가 다르면 `command`를 Node 실행 파일의 절대 경로로 지정 |
| 프로그램이 바로 종료됨 | `npm ci`와 `npm run build` 수행, Node 22.13 이상인지 확인 |
| `MYBOX_NOT_CONNECTED` | `mcp/.env` 위치와 `MYBOX_TOKEN` 확인, 에이전트 재시작 |
| `MYBOX_401` | PAT 만료·삭제·오타 확인, 새 토큰으로 교체 |
| `MYBOX_TLS_ERROR` / HTTPS 인증서 오류 | 최신 도우미는 PC의 신뢰 인증서를 사용합니다. 수동 실행의 Node.js는 22.19 이상 또는 24.5 이상으로 업데이트하고 보안 프로그램·프록시 설정 확인 |
| `MYBOX_TIMEOUT` / `MYBOX_DNS_ERROR` | 인터넷·VPN·프록시·DNS 확인. 토큰 오류와 별개이므로 네트워크 문제만으로 새 토큰을 반복 발급할 필요 없음 |
| 스캔에서 텍스트가 없음 | `mode=vision` 요청. 이미지가 반환돼야 현재 모델이 직접 읽을 수 있음 |
| HWP/Word의 그림이 없음 | 본문 추출만 지원. 원문을 PDF로 저장하고 vision 모드 사용 |
| `VISION_PAGE_LIMIT` | 이미지 호출을 3쪽 이하로 나누기. 텍스트만 필요하면 `mode=text` |
| 사진이 `INVALID_IMAGE` | 형식·손상 여부·약 16MP 입력 크기 확인, 해상도를 낮춰 다시 업로드 |
| 수식이 작거나 숫자가 모호함 | `width`를 높이거나 `crop`으로 확대, 실제 원문과 대조 |
| 원격 OAuth 연결 실패 | 외부 HTTPS, `MCP_PUBLIC_URL`과 실제 Host 일치, 연결 암호 확인. 서버 재시작 후 재인증 |
| PC에서는 되는데 모바일에서는 안 됨 | 로컬 stdio인지 확인. 모바일에는 원격 배포·앱 측 커넥터 지원 필요 |

## 개발과 검증

로컬/원격 MCP는 `mcp/`에 독립 npm 패키지로 들어 있습니다. 공통 MYBOX API와 문서 파서는 `lib/mybox/`를 재사용하며 빌드 시 포함됩니다. 웹 앱은 별도이며 기존 Sites 코드도 보존했습니다.

```bash
cd mcp
npm ci
npm test
```

현재 통합 테스트 35개는 실제 표준 MCP SDK를 통해 도구 목록·호출·이미지 블록, 다른 작업 폴더에서의 stdio 실행, 혼합 PDF의 스캔 선택, 원문 확대, 사진, 35MiB DOCX, 임시 파일 삭제, 토큰 오류, 원격 OAuth 승인·PKCE·토큰 갱신·폐기·인증 후 이미지 전달을 확인합니다. 설치 도우미의 다섯 앱 설정 보존·백업·복원, 토큰 교체, 숨김 입력, HTTP 접근 보호와 한글·공백 경로의 실제 MCP 시작도 포함합니다. 실제 HTTPS 테스트로 기존 CA 보존·신뢰하지 않는 인증서 거부·호스트 이름 검증 유지와 네트워크/토큰 오류 구분을 확인합니다. 테스트는 가짜 MYBOX 응답과 합성 문서를 사용하며 실제 개인 파일·토큰을 저장하지 않습니다. 심볼릭 링크 검사는 Windows에서 권한 문제로 건너뛰고 Linux/macOS에서 실행합니다.

로컬 검증 환경은 Windows / Node 24이며 기존 MCP는 Linux / Node 24에서도 검증했습니다. Windows 휴대용 Node 다운로드·체크섬·시작, 설치 화면·입력·오류·완료 동작을 브라우저에서 확인합니다. GitHub Actions는 Windows·macOS·Linux / Node 22에서 같은 통합 테스트를 실행합니다. 각 실행의 통과 여부는 저장소의 Actions에서 확인할 수 있습니다. 각 실제 코딩 에이전트의 화면·모델 동작까지 실행한 것은 아닙니다.

### MCP 도구

| 이름 | 기능 |
| --- | --- |
| `get_connection_status` | 설정 여부·제한·모델 이미지 읽기 방식 |
| `get_storage_info` | 저장 용량과 실제 API 연결 확인 |
| `search` | 파일 이름 검색 |
| `list_files` | 폴더와 파일 목록 |
| `get_file_info` | 파일 메타데이터 |
| `fetch` | 본문·페이지 이미지·사진 읽기 |

### 기존 ChatGPT Site 구현

루트의 `app/`, `db/`, `.openai/`, `scripts/`는 기존 ChatGPT Sites용 웹 연결 구현입니다. **기존 Site를 배포한 상태와 이번 Node MCP를 배포하는 것은 별개의 작업입니다.** GitHub 업로드는 기존 개인 Site의 배포나 공개 범위를 변경하지 않습니다.

기존 Site의 서버 측 자동 OCR은 Mistral 설정을 사용하는 이전 방식입니다. 이번의 **별도 OCR 키 없는 모델 이미지 읽기는 `mcp/`의 로컬·원격 Node 구현**에서 제공합니다. 기존 Site의 Cloudflare Worker에는 Node PDF 렌더러를 그대로 넣을 수 없습니다.

Sites의 D1/R2·사용자 인증·토큰 암호화·배포 절차와 기존 파서 검증은 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)에 있습니다. 배포 대상의 프로젝트 ID와 실제 비밀 값은 공개 소스에서 제외했습니다.

## 데이터 처리

- MYBOX PAT는 고정된 네이버 API에만 전달하며 파일 다운로드 주소로 전달하지 않습니다.
- 다운로드 주소는 네이버 관련 HTTPS 도메인으로 제한합니다.
- 로컬/원격 Node 서버는 원본을 임시 파일로 스트리밍하고 처리 후 삭제합니다.
- 모델에 반환한 문서·이미지는 사용 중인 AI 서비스가 처리합니다. 해당 앱이 대화·도구 결과를 저장할 수 있습니다.
- 원격 연결은 서버 소유자 암호 승인과 OAuth 토큰이 필요합니다. PAT 자체를 앱의 로그인 비밀번호로 보내지 않습니다.
- 원본 변경·삭제 도구는 제공하지 않으며, 문서 내부 지시는 외부 데이터로 취급합니다.

## 공식 참고 문서

- [MYBOX Open API 시작하기](https://developers.mybox.naver.com/getting-started)
- [Codex MCP 설정](https://developers.openai.com/codex/mcp)
- [Claude Code MCP 설정 및 이미지 결과](https://code.claude.com/docs/en/mcp)
- [Antigravity MCP 설정](https://antigravity.google/docs/mcp)
- [Gemini CLI MCP 설정](https://geminicli.com/docs/tools/mcp-server/)
- [ChatGPT 플러그인 지원 범위](https://learn.chatgpt.com/docs/plugins)
- [Claude 원격 커넥터](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Gemini 앱 사용자 MCP 연결 조건](https://support.google.com/gemini/answer/17209137)
- [MCP 공식 SDK](https://github.com/modelcontextprotocol/typescript-sdk)
