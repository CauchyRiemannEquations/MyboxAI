# MYBOX · GPT 연결

네이버 MYBOX 공식 Open API를 사용하는 개인용 MCP 서버와 연결 화면입니다. ChatGPT의 Sites 플러그인으로 사용합니다.

## 사용하기

1. 네이버 MYBOX 웹에서 **설정 → 계정 및 개인 액세스 토큰 관리 → 토큰 생성**을 선택합니다.
2. 개인 연결 화면에서 발급한 토큰을 입력하고 **MYBOX 연결하기**를 누릅니다.
3. ChatGPT에서 이 Site의 플러그인을 설치합니다. **플러그인 → 개인 → 내가 만든 플러그인**에서 찾을 수 있습니다.
4. 예: `MYBOX에서 미분 자료를 찾아서 내용을 요약해줘.`

토큰은 채팅에 붙여 넣지 않고 연결 화면에 입력합니다. 토큰 만료 시 새 토큰으로 교체합니다. 연결 해제는 저장된 토큰을 삭제하며 MYBOX 파일은 변경하지 않습니다. 네이버에서 토큰 자체를 폐기하려면 MYBOX 설정에서도 삭제합니다.

## 기능

| MCP 도구 | 기능 |
| --- | --- |
| `get_connection_status` | 현재 사용자의 연결 상태 및 설정 화면 안내 |
| `search` | 파일 이름·종류로 검색, 폴더 경로 필터, 커서 페이지 조회 |
| `list_files` | 루트 또는 특정 폴더의 파일·하위 폴더 조회 |
| `get_file_info` | 파일 크기, 이름, 수정일 등의 메타데이터 |
| `fetch` | 문서 텍스트 추출, 텍스트·PDF 쪽 범위 이어 읽기 |
| `get_storage_info` | 계정 용량과 파일 개수 조회 |

PDF는 **100MiB**, HWP 5/HWPX/DOCX 및 UTF-8/EUC-KR/UTF-16LE 텍스트는 **50MiB**, OCR용 PNG/JPEG/WEBP는 **20MiB**까지 지원합니다. 큰 파일은 비공개 R2에 스트리밍으로 임시 저장하고 필요한 범위만 읽습니다. PDF는 범위 읽기, DOCX/HWPX는 본문 XML만, HWP는 FileHeader와 BodyText 스트림만 처리합니다. 삽입 그림 전체를 메모리에 올리지 않습니다. 읽기가 끝나면 임시 원본을 삭제하며, 중단된 작업의 원본은 이후 읽기에서 1시간 이상 지난 항목을 제한된 개수로 정리합니다. 별도 예약 삭제 작업은 없습니다.

압축 해제된 본문은 8MiB, 추출 문자 100만 자, 요청당 원본 범위 읽기는 32MiB로 제한합니다. 파일 크기가 범위 안이어도 복잡한 문서는 제한될 수 있습니다. PDF 텍스트 읽기는 기본 15쪽/최대 25쪽입니다. OCR 사용 시 기본/최대 5쪽이며 `start_page`, `page_count`로 범위를 정합니다. 텍스트는 512KiB 단위로 읽고 `next_start_byte`로 이어 읽습니다. 반환 텍스트는 기본 24,000자/최대 40,000자이며 `next_offset`을 같은 범위에 전달합니다.

파일 이름 검색이며 문서 본문 전체 검색이나 검색 색인은 제공하지 않습니다. HWP 암호화·배포용 문서와 오래된 HWP 3 문서는 지원하지 않습니다. 수식·그림·표 배치는 완전히 재현되지 않으며 MYBOX API는 암호 폴더와 공유 받은 폴더를 지원하지 않습니다.

## 자동 OCR

연결 화면의 **자동 OCR 연결**에서 Mistral API 키와 하루 처리 한도(기본 50쪽, 1~500쪽)를 입력합니다. 문서 전송과 별도 요금에 동의한 뒤 저장합니다. 키 검증은 무료 모델 목록 조회로 진행하며 OCR은 파일을 읽을 때만 호출합니다. 모델은 `mistral-ocr-4-1`에 고정합니다.

- `ocr=auto`: PDF 쪽의 공백 제외 추출 문자가 20자 미만이면 OCR로 처리합니다. 사진은 OCR로 읽습니다. 이 판별은 단순 휴리스틱이며 모든 스캔을 감지하지는 못합니다.
- `ocr=always`: 선택한 PDF 쪽을 OCR로 다시 읽습니다. 수식·표가 누락되었을 때 사용합니다.
- `ocr=never`: OCR 호출 없이 PDF 본문 텍스트만 읽습니다.
- 요청한 쪽 번호만 Mistral의 `pages`에 0부터 시작하는 번호로 전달합니다. 단, **원본 문서 전체에 접근할 수 있는 MYBOX 임시 다운로드 주소가 Mistral에 전송**됩니다. MYBOX PAT는 전송하지 않습니다. 일반 텍스트 추출은 Mistral에 문서를 보내지 않습니다.
- 사용자·파일 ID·이름·수정일·크기·쪽·모델을 키로 OCR 텍스트를 AES-GCM 암호화해 7일 캐시합니다. 수정일이 없으면 캐시하지 않습니다. 캐시는 같은 내용을 다시 읽을 때 API 호출을 줄이지만, 동시에 시작한 중복 요청은 각각 처리될 수 있습니다.
- 처리할 새 쪽 수를 D1의 조건부 UPSERT로 원자적으로 예약합니다. 하루 한도는 UTC 자정에 초기화하며, 실패·시간 초과 요청도 한도에 포함합니다. 과금 여부가 불명확하므로 자동 재시도와 예약 수 환불은 하지 않습니다. Mistral의 실제 청구액을 제한하는 예산 기능은 아닙니다.
- OCR 사용 해제 시 저장된 Mistral 키와 캐시를 삭제합니다. 당일 사용량은 한도 우회를 막기 위해 유지합니다. MYBOX 연결 해제 시 두 API 키와 OCR 캐시를 삭제하며 MYBOX 원본은 변경하지 않습니다.

ChatGPT 구독과 Mistral API 요금은 별도입니다. 공식 요금과 공급자 계정의 제한을 확인하세요. OCR 숫자·기호·수식은 원문과 비교해야 하며 도형의 의미 해석을 보장하지 않습니다.

## 접근과 토큰 저장

- Site는 소유자 전용으로 게시합니다. Sites가 OAuth와 ChatGPT 인증 경계를 관리합니다.
- 개인정보가 없는 MCP 초기화·도구 목록만 익명 발견을 허용하며, 실제 호출과 모든 개인 API는 인증된 사용자 ID와 이메일을 요구합니다.
- D1의 연결 정보는 Site별 사용자 ID로 분리합니다. 토큰은 서버 비밀키를 사용하는 AES-256-GCM으로 암호화하며 사용자 ID를 인증 부가 데이터로 사용합니다.
- `MYBOX_TOKEN_ENCRYPTION_KEY`는 32바이트의 Base64 환경 비밀값입니다. 최초 배포 시 생성합니다. 교체하면 기존 연결은 새 토큰 입력이 필요합니다.
- 네이버 토큰은 공식 API 호스트에만 전송합니다. 다운로드는 공식 API가 발급한 HTTPS 주소를 사용하며 토큰 헤더를 전달하지 않습니다. 리다이렉트 목적지와 크기 제한을 검사합니다.
- 토큰 변경·OCR 설정·연결 해제·문서 읽기는 인증과 동일 출처 POST/DELETE를 요구합니다. 읽기 GET은 요금 발생과 링크 사전 로딩을 방지하기 위해 405를 반환합니다. 토큰을 응답, 브라우저 저장소, 소스 파일, 로그에 기록하지 않습니다.
- v0.3은 파일 관리 MCP 도구도 제공합니다. 공유 관리 구현을 통해 업로드·덮어쓰기·이름 변경·이동·복사·삭제·복원·즐겨찾기·휴지통 관리를 지원합니다. Site의 파일 전송은 텍스트·Base64(8MiB)·서명 URL 방식이며 서버 파일 경로를 읽지 않습니다. 상세 도구는 [파일 관리 안내](FILE_MANAGEMENT.md)를 확인하세요. MYBOX PAT 자체는 광범위한 네이버 권한을 가집니다.

## 개발과 검증

Vinext/React, Cloudflare Workers, D1, R2, Drizzle을 사용합니다. `.openai/hosting.json`이 Site ID, `DB`/`BUCKET` 바인딩, `mcp` 기능을 선언합니다. `/mcp`는 세션 없는 Streamable HTTP POST이며 legacy MCP 초기화, 도구 목록, 도구 호출, ping, 알림을 지원합니다. GET/SSE는 요구하지 않고 405로 응답합니다.

```sh
node node_modules/typescript/bin/tsc --noEmit --incremental false
node scripts/verify-mybox.mjs
node scripts/verify-upgrade.mjs
```

검증은 사용자별 암호화·격리, 익명 호출 거부, 요청 형식, 도구 입력, 커서, PAT가 없는 다운로드, 안전한 리다이렉트, 크기 제한, PDF/HWP/HWPX/DOCX 추출을 다룹니다. PDF·암호화·D1·MCP 코드는 실제 Cloudflare workerd에서도 검증합니다. 파일 API 응답은 공식 규격에 따른 모의 응답으로 검사하며 **실제 MYBOX 계정 연동은 사용자의 토큰 입력 후 확인해야 합니다.**

업그레이드 검증은 80MiB PDF 스트리밍·R2 범위 읽기·삭제, 35MiB DOCX와 30MiB HWP의 그림 건너뛰기, 혼합 PDF의 자동 OCR, 쪽 번호, 캐시 재사용·격리·암호화, 하루 한도의 동시성, 공급자 오류와 자동 재시도 방지 등을 포함합니다. **Mistral 응답은 모의 데이터이며 실제 API 접근·다운로드 주소 수락과 한국어/수식 인식 정확도는 API 키 연결 후 확인해야 합니다.**

브라우저 WebMCP는 해당 기능을 지원하는 브라우저에서 검색·문서 열기 두 도구를 선택적으로 등록합니다. 현재 작업 환경에서는 브라우저 WebMCP 상호작용 검증을 수행하지 못했습니다. 원격 MCP와 별개이며 미지원 브라우저에서도 화면과 원격 플러그인은 사용할 수 있습니다.

## 공식 문서

- [MYBOX 시작하기·토큰](https://developers.mybox.naver.com/getting-started)
- [MYBOX 파일 검색](https://developers.mybox.naver.com/docs/search_files_resources)
- [MYBOX 폴더 조회](https://developers.mybox.naver.com/docs/dms_list)
- [MYBOX 파일 다운로드](https://developers.mybox.naver.com/docs/files_download)
- [한컴 HWP 본문 구조](https://tech.hancom.com/python-hwp-parsing-2/)
- [OpenAI 플러그인](https://developers.openai.com/plugins/quickstart)
- [Mistral OCR API](https://docs.mistral.ai/api/endpoint/ocr)
- [Mistral OCR 4.1](https://docs.mistral.ai/models/ocr-4-1)
- [Mistral API 요금](https://docs.mistral.ai/inference/pricing)

네이버의 공식 제품이 아닌 개인 연결 도구입니다.
