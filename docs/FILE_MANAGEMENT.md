# MYBOX 파일 관리 · v0.3

읽기·스캔 인식에 더해 공식 MYBOX Open API 목록의 20개 작업을 지원합니다. 로컬 MCP에는 24개 도구가 있으며, 원격 쓰기 승인 및 기존 Site 코드에는 서버 파일 경로 도구를 제외한 22개가 있습니다. 실제 개인 파일은 테스트에서 변경하지 않습니다.

## 사용할 수 있는 작업

| 작업 | 도구 |
| --- | --- |
| 연결·용량·정보 조회 | `get_connection_status`, `get_storage_info`, `get_file_info` |
| 파일/폴더 검색·목록 | `search`, `search_folders`, `list_files` |
| 문서·스캔·사진 읽기 | `fetch` |
| 폴더 생성 | `create_folder` |
| 로컬 파일 업로드 / 원본 다운로드 | `upload_file`, `download_file` · 로컬 기본 제공 |
| UTF-8 텍스트 / 바이너리 업로드 | `upload_text`, `upload_data` |
| 서명 업로드·다운로드 주소 | `create_upload_url`, `get_download_url` |
| 이름 변경·이동·복사 | `rename_resource`, `move_resource`, `copy_resource` |
| 즐겨찾기 등록·해제 | `set_favorite` |
| 삭제·휴지통 조회·복원 | `delete_resource`, `list_trash`, `restore_resource` |
| 휴지통의 개별 항목 영구 삭제 / 전체 비우기 | `permanently_delete_resource`, `empty_trash` |
| 휴지통 자동 삭제 주기 | `set_trash_auto_delete` · 0(끄기), 5, 15, 30, 50일 |

파일/폴더의 `id`는 실제 조회 결과의 `id` 또는 `resourceId`를 사용합니다. 검색은 이름 검색이며 본문 색인은 아닙니다. 파일 검색은 `start_date`, `end_date`, `date_field=created|modified`를 지원합니다. 폴더 검색은 `path` 조건도 지원하며 이 경우 네이버가 다른 조건을 무시합니다. 목록은 `cursor`, 최대 `count=1000`, `sort=modifiedAt,desc` 등을 지원합니다.

## 파일 내용 수정과 업로드

네이버는 문서 내용 직접 편집 API를 제공하지 않습니다. 원본을 다운로드한 뒤 원하는 형식으로 편집하고 **수정한 전체 파일을 동일한 이름·폴더에 다시 업로드**합니다. `overwrite`의 기본값은 false이며 true를 지정하면 같은 이름의 기존 파일을 대체합니다.

```text
MYBOX에 '수업 자료' 폴더를 만들어 줘.
PC의 C:/자료/수업.docx를 그 폴더에 업로드해 줘.
회의록.docx를 PC에 다운로드하고 수정한 뒤 원래 폴더에 같은 이름으로 덮어써 줘.
'이전 자료' 폴더를 '보관 자료'로 바꿔 줘.
그 PDF를 '보관 자료'로 이동하고 즐겨찾기에 추가해 줘.
지정한 중복 파일을 휴지통으로 옮겨 줘.
휴지통 목록에서 그 파일을 원래 위치로 복원해 줘.
```

로컬 `upload_file`은 `local_path`의 실제 파일을 스트리밍하며 프로그램 상한 50GiB와 계정의 `maxFileBytes`를 적용합니다. `resume=true`는 파일 수정일과 함께 업로드 URL을 생성하고 반환된 offset부터 보냅니다. 다운로드는 기존 로컬 파일을 덮어쓰지 않으며, 실패한 부분 파일은 제거합니다. 문서 파서의 100/50/20MiB 제한은 `fetch`에 적용되고 원본 전송 도구와 별개입니다.

파일 전송 요청의 서버 시간 제한은 30분입니다. 큰 파일은 사용하는 앱의 도구 시간 제한도 늘려야 합니다. 예를 들어 Codex의 `tool_timeout_sec=1800`, Gemini CLI의 `timeout=1800000`, Claude Code 실행 환경의 `MCP_TOOL_TIMEOUT=1800000`을 사용할 수 있습니다. 연결 도우미의 기본 설정은 180초이며 크기 상한 안의 파일도 네트워크 속도와 앱 제한에 따라 중단될 수 있습니다.

`upload_text`는 최대 100만 자의 UTF-8 텍스트입니다. DOCX/HWP/PDF 같은 바이너리 형식은 `upload_file` 또는 `upload_data`로 실제 형식의 바이트를 전송하세요. `upload_data`는 표준 Base64로 최대 8MiB를 받습니다. `create_upload_url`만 호출하면 파일 업로드가 완료되지 않으며, 반환 URL에 **PAT 없이** multipart/form-data의 **Filedata** 필드로 POST 해야 합니다. URL은 48시간/한 번의 업로드용입니다. `get_download_url`의 서명 URL도 접근 권한을 포함하므로 공개하지 마세요.

## 삭제와 원격 승인

`delete_resource`는 휴지통 이동입니다. `permanently_delete_resource`와 `empty_trash`는 복구할 수 없는 영구 삭제이며, 명시적인 요청 후 `confirm_permanent=true` 인자를 지정해야 합니다. MCP 도구의 읽기/변경/파괴적 작업 주석을 실제 동작에 맞게 제공합니다. 이 인자는 클라이언트의 사용자 승인 정책을 대신하는 보안 경계가 아닙니다.

원격 OAuth는 `mybox:read`와 `mybox:write`를 구분합니다. 기존 읽기 승인은 관리 도구를 제공하지 않으며, 쓰기 작업에는 **`mybox:read mybox:write`로 다시 승인**해야 합니다. 승인 화면에 업로드·변경·삭제 범위를 표시합니다. 토큰 갱신으로 승인하지 않은 쓰기 권한을 추가할 수 없습니다.

원격 서버의 로컬 파일 경로 도구는 기본 비활성화입니다. 관리자가 `.env`의 `MYBOX_TRANSFER_DIR`에 전용 폴더의 절대 경로를 지정하면 해당 폴더 안에서만 제공합니다. 경로는 심볼릭 링크를 해석한 실제 경로로 검사합니다. 원격 앱에서 보내는 문서는 `upload_text`, `upload_data`, 또는 서명 업로드 URL을 사용합니다.

로컬 서버를 읽기만 제공하도록 운영하려면 `MYBOX_READ_ONLY=true`를 설정하세요. 기본값은 파일 관리 활성화입니다. 전송·복사·삭제 요청을 자동 재시도하지 않습니다. `MYBOX_MUTATION_UNCERTAIN`이나 업로드 중단은 이미 작업이 반영됐을 가능성이 있으므로 실제 목록·파일 정보를 먼저 확인하세요.

## 공식 API 대응표

| 공식 문서 | MCP 작업 |
| --- | --- |
| [내 파일 속성](https://developers.mybox.naver.com/docs/dms_storage) | `get_storage_info` |
| [루트 목록](https://developers.mybox.naver.com/docs/dms_root) | `list_files` |
| [폴더 내 목록](https://developers.mybox.naver.com/docs/dms_list) | `list_files(folder_id)` |
| [개별 속성](https://developers.mybox.naver.com/docs/dms_resourceId) | `get_file_info` |
| [폴더 생성](https://developers.mybox.naver.com/docs/files_create_folder) | `create_folder` |
| [업로드 URL](https://developers.mybox.naver.com/docs/files_upload) | `create_upload_url` 및 실제 업로드 도구 |
| [다운로드 URL](https://developers.mybox.naver.com/docs/files_download) | `get_download_url`, `download_file`, `fetch` |
| [복사](https://developers.mybox.naver.com/docs/files_copy) | `copy_resource` |
| [삭제](https://developers.mybox.naver.com/docs/files_delete) | `delete_resource` |
| [이동](https://developers.mybox.naver.com/docs/files_move) | `move_resource` |
| [이름 변경](https://developers.mybox.naver.com/docs/files_rename) | `rename_resource` |
| [즐겨찾기](https://developers.mybox.naver.com/docs/dms_favorite) | `set_favorite(true)` |
| [즐겨찾기 해제](https://developers.mybox.naver.com/docs/dms_unfavorite) | `set_favorite(false)` |
| [파일 검색](https://developers.mybox.naver.com/docs/search_files_resources) | `search` |
| [폴더 검색](https://developers.mybox.naver.com/docs/search_folders_resources) | `search_folders` |
| [휴지통 목록](https://developers.mybox.naver.com/docs/dms_trash_list) | `list_trash` |
| [복원](https://developers.mybox.naver.com/docs/files_trash_restore) | `restore_resource` |
| [개별 영구 삭제](https://developers.mybox.naver.com/docs/files_trash_clean_resourceId) | `permanently_delete_resource` |
| [휴지통 비우기](https://developers.mybox.naver.com/docs/files_trash_clean) | `empty_trash` |
| [자동 삭제 주기](https://developers.mybox.naver.com/docs/dms_trash_routine) | `set_trash_auto_delete` |

암호 폴더·공유 받은 폴더·본문 검색·문서 공동 편집·공유 링크 관리처럼 공식 API에 없는 기능은 제공하지 않습니다. 업로드·이동 등의 실제 네이버 계정 동작은 개인 PAT로 사용하면서 확인해야 합니다. 테스트는 모의 네이버 API와 합성 파일을 사용합니다.
