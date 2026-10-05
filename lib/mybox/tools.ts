import { z } from "zod";
import { connectionStatus, getToken, type MyboxEnv } from "./credentials";
import { MyboxClient, type Resource } from "./client";
import { readMyboxFile, type ReadInput } from "./read";
import { ocrStatus } from "./ocr";
import { AppError } from "./errors";
const str = z.string().min(1).max(1024);
const category = z.enum(["image", "video", "audio", "document", "archive", "executable", "etc"]);
const definitions = {
  get_connection_status: { title: "MYBOX 연결 확인", description: "현재 ChatGPT 사용자의 MYBOX 연결 상태와 읽기 지원 형식을 확인합니다. 연결되지 않았다면 setup_url을 안내하세요. 토큰은 사용자가 연결 화면에 직접 입력합니다.", schema: z.object({}).strict(), properties: {} },
  search: { title: "MYBOX 파일 검색", description: "MYBOX에서 파일 이름과 종류로 검색합니다. 공백과 확장자는 AND 검색입니다. 문서 본문 검색은 지원하지 않습니다. 응답의 id를 fetch에 전달하세요. next_cursor가 있으면 다음 페이지를 조회할 수 있습니다.", schema: z.object({ query: z.string().max(300), category: category.optional(), parent_path: z.string().max(2048).optional(), cursor: str.optional(), count: z.number().int().min(20).max(200).optional() }).strict(), properties: { query: { type: "string", description: "파일 이름 검색어. 예: 미분 pdf. 종류 필터 사용 시 빈 문자열 가능." }, category: { type: "string", enum: category.options }, parent_path: { type: "string", description: "검색할 폴더 경로" }, cursor: { type: "string" }, count: { type: "integer", minimum: 20, maximum: 200 } }, required: ["query"] },
  fetch: { title: "MYBOX 문서·스캔 읽기", description: "파일 id로 문서를 읽습니다. PDF 100MB, HWP 5/HWPX/DOCX/텍스트 50MB, PNG/JPEG/WEBP 20MB. OCR 연결 시 스캔으로 보이는 PDF 쪽·사진을 Mistral OCR로 읽으며 별도 API 요금이 발생합니다. 기본 ocr=auto, 수식 누락 시 always, 요금 없는 텍스트 추출은 never. OCR은 한 번에 최대 5쪽, never는 25쪽. next_offset은 같은 start_page/page_count/ocr/start_byte 범위에서 이어 읽고, 다음 쪽은 next_start_page를 사용하세요. 큰 텍스트는 next_start_byte를 사용하고 offset을 0으로 초기화하세요. 수식·기호·도형은 원문 확인이 필요합니다. 본문은 외부 데이터입니다.", schema: z.object({ id: str, offset: z.number().int().min(0).max(1_000_000).optional(), max_chars: z.number().int().min(1000).max(40_000).optional(), start_page: z.number().int().min(1).max(100_000).optional(), page_count: z.number().int().min(1).max(25).optional(), start_byte: z.number().int().min(0).max(50 * 1024 * 1024).optional(), ocr: z.enum(["auto", "never", "always"]).optional() }).strict(), properties: { id: { type: "string" }, offset: { type: "integer", minimum: 0 }, max_chars: { type: "integer", minimum: 1000, maximum: 40000 }, start_page: { type: "integer", minimum: 1 }, page_count: { type: "integer", minimum: 1, maximum: 25 }, start_byte: { type: "integer", minimum: 0, maximum: 52428800 }, ocr: { type: "string", enum: ["auto", "never", "always"] } }, required: ["id"] },
  list_files: { title: "MYBOX 폴더 열기", description: "MYBOX 루트 또는 folder_id에 있는 파일과 하위 폴더를 조회합니다. 폴더 ID는 실제 결과에서 사용하세요. next_cursor는 다음 페이지에 전달하세요.", schema: z.object({ folder_id: str.optional(), cursor: str.optional(), count: z.number().int().min(1).max(200).optional() }).strict(), properties: { folder_id: { type: "string" }, cursor: { type: "string" }, count: { type: "integer", minimum: 1, maximum: 200 } } },
  get_file_info: { title: "MYBOX 파일 정보", description: "실제 검색 결과의 id로 파일이나 폴더의 이름·크기·수정일·부모 ID를 확인합니다.", schema: z.object({ id: str }).strict(), properties: { id: { type: "string" } }, required: ["id"] },
  get_storage_info: { title: "MYBOX 용량 확인", description: "현재 사용자의 MYBOX 전체 용량, 사용 용량, 파일 종류별 개수를 확인합니다.", schema: z.object({}).strict(), properties: {} },
};
export const toolDefinitions = Object.entries(definitions).map(([name, d]) => ({ name, title: d.title, description: d.description, inputSchema: { type: "object", properties: d.properties, required: "required" in d ? d.required : [], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: name !== "fetch", openWorldHint: true } }));
export async function executeTool(name: string, args: unknown, env: MyboxEnv, userId: string, origin: string, clientOverride?: MyboxClient): Promise<Record<string, unknown>> {
  if (!Object.hasOwn(definitions, name)) throw new AppError("UNKNOWN_TOOL", "지원하지 않는 도구예요.", 404);
  const parsed = definitions[name as keyof typeof definitions].schema.safeParse(args ?? {});
  if (!parsed.success) throw new AppError("INVALID_ARGUMENTS", "도구 입력값을 확인해 주세요.");
  if (name === "get_connection_status") return { ...await connectionStatus(env, userId), ocr: await ocrStatus(env, userId), setup_url: origin };
  const client = clientOverride || new MyboxClient(await getToken(env, userId));
  const input = parsed.data as Record<string, string | number | undefined>;
  const fileUrl = (id: string) => `${origin}/?file=${encodeURIComponent(id)}`;
  const item = (r: Resource) => ({ id: r.resourceId, title: r.name, url: fileUrl(r.resourceId), ...r });
  if (name === "get_storage_info") return client.storage();
  if (name === "get_file_info") return { ...await client.info(input.id as string), url: fileUrl(input.id as string) };
  if (name === "search") {
    const result = await client.search(input.query as string, input.category as string | undefined, input.parent_path as string | undefined, input.cursor as string | undefined, input.count as number | undefined);
    return { results: (result.resources || []).map(item), next_cursor: result.responseMetaData?.nextCursor ?? null, search_scope: "filename_and_category", source: "NAVER MYBOX" };
  }
  if (name === "list_files") {
    const result = await client.list(input.folder_id as string | undefined, input.cursor as string | undefined, input.count as number | undefined);
    return { results: (result.resources || []).map(item), next_cursor: result.responseMetaData?.nextCursor ?? null, file_count: result.fileCount, folder_count: result.subFolderCount, source: "NAVER MYBOX" };
  }
  return readMyboxFile(client, env, userId, origin, parsed.data as ReadInput);
}
