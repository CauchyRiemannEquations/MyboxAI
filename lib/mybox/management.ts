import { z } from "zod";
import { AppError, type MyboxClient } from "./client";

const id = z.string().min(1).max(1024).regex(/^[^\x00-\x20\x7f]+$/);
const name = z.string().min(1).max(255).refine(value => !/[\\/\x00-\x1f\x7f]/.test(value) && ![".", ".."].includes(value), "파일/폴더의 이름만 입력하세요.");
const date = z.string().datetime({ offset: true });
const overwrite = z.boolean().default(false);
const annotations = (readOnly = false, destructive = false, idempotent = false) => ({ readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: true });
export const searchDateSchema = { start_date: date.optional(), end_date: date.optional(), date_field: z.enum(["created", "modified"]).optional() };
export const managementDefinitions = {
  search_folders: { description: "폴더 이름·경로·생성일/수정일로 검색합니다. path를 지정하면 다른 조건은 무시됩니다.", annotations: annotations(true, false, true), schema: z.object({ query: z.string().max(300).default(""), parent_path: z.string().max(2048).optional(), path: z.string().max(2048).optional(), cursor: id.optional(), count: z.number().int().min(20).max(200).default(20), ...searchDateSchema }).strict() },
  list_trash: { description: "휴지통의 파일/폴더를 조회합니다. 반환된 실제 id로 복원하거나 영구 삭제하세요.", annotations: annotations(true, false, true), schema: z.object({ cursor: id.optional(), count: z.number().int().min(1).max(1000).default(100), sort: z.string().regex(/^(deletedAt|name|type|location|size),(asc|desc)$/).default("deletedAt,desc") }).strict() },
  get_download_url: { description: "파일의 네이버 임시 다운로드 URL을 반환합니다. 이 URL은 파일 접근 권한을 담고 있으므로 공개하지 마세요.", annotations: annotations(true, false, true), schema: z.object({ id }).strict() },
  create_folder: { description: "폴더를 생성합니다. parent_id를 생략하면 루트에 생성합니다.", annotations: annotations(), schema: z.object({ name, parent_id: id.optional() }).strict() },
  create_upload_url: { description: "공식 업로드 URL을 생성합니다. URL에 PAT 없이 multipart/form-data Filedata 필드로 POST 해야 파일 업로드가 완료됩니다. URL은 48시간/1회용입니다. resume=true이면 modified_time도 필요하며 반환 offset부터 전송하세요. URL만 생성하는 작업과 실제 파일 업로드를 구분하세요.", annotations: annotations(false, true), schema: z.object({ file_name: name, file_size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), parent_id: id.optional(), overwrite, resume: z.boolean().default(false), modified_time: date.optional() }).strict() },
  upload_text: { description: "UTF-8 텍스트를 실제 파일로 업로드합니다. 문서 내용 수정은 같은 이름·폴더를 지정하고 overwrite=true로 수정한 전체 내용을 다시 업로드하세요. 덮어쓰기는 기존 내용을 대체합니다.", annotations: annotations(false, true), schema: z.object({ file_name: name, text: z.string().max(1_000_000), parent_id: id.optional(), overwrite }).strict() },
  upload_data: { description: "Base64로 전달한 바이너리 파일을 업로드합니다(최대 8MiB). 로컬의 큰 파일에는 upload_file을 사용하세요. overwrite 기본값은 false입니다.", annotations: annotations(false, true), schema: z.object({ file_name: name, content_base64: z.string().max(11_184_812), parent_id: id.optional(), overwrite }).strict() },
  rename_resource: { description: "파일/폴더 이름을 변경합니다. ID는 유지됩니다. 확장자도 포함한 전체 이름을 지정하세요.", annotations: annotations(false, true, true), schema: z.object({ id, name }).strict() },
  move_resource: { description: "파일/폴더를 parent_id 폴더로 이동합니다. 루트로 이동하려면 실제 루트 폴더 ID를 지정하세요. overwrite=true는 대상의 같은 이름을 덮어씁니다.", annotations: annotations(false, true), schema: z.object({ id, parent_id: id, overwrite }).strict() },
  copy_resource: { description: "파일/폴더를 복사합니다. parent_id 생략 시 루트, name 생략 시 원본 이름을 사용합니다. overwrite=true는 대상의 같은 이름을 덮어씁니다.", annotations: annotations(false, true), schema: z.object({ id, parent_id: id.optional(), name: name.optional(), overwrite }).strict() },
  delete_resource: { description: "파일/폴더를 삭제하여 휴지통으로 이동합니다. 폴더 삭제는 하위 항목도 영향을 받습니다. 사용자가 지정한 실제 id만 사용하세요.", annotations: annotations(false, true), schema: z.object({ id }).strict() },
  restore_resource: { description: "휴지통의 파일/폴더를 원래 위치로 복원합니다. overwrite=true는 같은 이름의 현재 항목을 덮어씁니다.", annotations: annotations(false, true), schema: z.object({ id, overwrite }).strict() },
  permanently_delete_resource: { description: "휴지통의 파일/폴더를 영구 삭제합니다. 복구할 수 없습니다. 대상에 대한 사용자의 명시적 영구 삭제 요청을 받은 뒤 confirm_permanent=true로 호출하세요.", annotations: annotations(false, true), schema: z.object({ id, confirm_permanent: z.literal(true) }).strict() },
  empty_trash: { description: "MYBOX 휴지통 전체를 영구적으로 비웁니다. 복구할 수 없습니다. 사용자가 휴지통 전체 비우기를 명시적으로 요청한 뒤 confirm_permanent=true로 호출하세요.", annotations: annotations(false, true), schema: z.object({ confirm_permanent: z.literal(true) }).strict() },
  set_favorite: { description: "파일/폴더 즐겨찾기를 설정합니다. enabled=true 등록, false 해제.", annotations: annotations(false, false, true), schema: z.object({ id, enabled: z.boolean() }).strict() },
  set_trash_auto_delete: { description: "휴지통 자동 삭제 주기를 설정합니다. 0은 끄기, 나머지는 5/15/30/50일. 주기가 지나면 항목이 영구 삭제되는 계정 설정입니다.", annotations: annotations(false, true, true), schema: z.object({ days: z.union([z.literal(0), z.literal(5), z.literal(15), z.literal(30), z.literal(50)]) }).strict() },
};

export function dateFilters(input: { start_date?: string; end_date?: string; date_field?: string }) { return { startDate: input.start_date, endDate: input.end_date, dateField: input.date_field }; }
export function isManagementTool(value: string): value is keyof typeof managementDefinitions { return Object.hasOwn(managementDefinitions, value); }
const properties: Record<string, unknown> = {
  id: { type: "string", minLength: 1, maxLength: 1024 }, name: { type: "string", minLength: 1, maxLength: 255 }, parent_id: { type: "string" },
  file_name: { type: "string", minLength: 1, maxLength: 255 }, file_size: { type: "integer", minimum: 0 }, overwrite: { type: "boolean", default: false }, resume: { type: "boolean", default: false }, modified_time: { type: "string", format: "date-time" },
  text: { type: "string", maxLength: 1000000 }, content_base64: { type: "string", maxLength: 11184812 }, query: { type: "string", maxLength: 300 }, parent_path: { type: "string" }, path: { type: "string" }, cursor: { type: "string" },
  count: { type: "integer", minimum: 1, maximum: 1000 }, sort: { type: "string", pattern: "^(deletedAt|name|type|location|size),(asc|desc)$" },
  start_date: { type: "string", format: "date-time" }, end_date: { type: "string", format: "date-time" }, date_field: { type: "string", enum: ["created", "modified"] },
  enabled: { type: "boolean" }, days: { type: "integer", enum: [0, 5, 15, 30, 50] }, confirm_permanent: { type: "boolean", const: true },
};
const required: Record<string, string[]> = {
  get_download_url: ["id"], create_folder: ["name"], create_upload_url: ["file_name", "file_size"], upload_text: ["file_name", "text"], upload_data: ["file_name", "content_base64"], rename_resource: ["id", "name"], move_resource: ["id", "parent_id"], copy_resource: ["id"], delete_resource: ["id"], restore_resource: ["id"], permanently_delete_resource: ["id", "confirm_permanent"], empty_trash: ["confirm_permanent"], set_favorite: ["id", "enabled"], set_trash_auto_delete: ["days"],
};
export const managementToolDefinitions = Object.entries(managementDefinitions).map(([name, definition]) => ({
  name, description: definition.description, annotations: definition.annotations,
  inputSchema: { type: "object", properties: Object.fromEntries(Object.keys(definition.schema.shape).map(key => [key, key === "count" && name === "search_folders" ? { type: "integer", minimum: 20, maximum: 200 } : properties[key]])), required: required[name] || [], additionalProperties: false },
}));
export async function executeManagement(name: string, args: unknown, client: MyboxClient): Promise<Record<string, unknown>> {
  if (!isManagementTool(name)) throw new AppError("UNKNOWN_TOOL", "지원하지 않는 도구입니다.");
  const parsed = managementDefinitions[name].schema.safeParse(args ?? {});
  if (!parsed.success) throw new AppError("INVALID_ARGUMENTS", "도구 입력값을 확인하세요. 영구 삭제는 confirm_permanent=true가 필요합니다.");
  const input = parsed.data as any;
  let result: unknown;
  switch (name) {
    case "search_folders": result = await client.searchFolders(input.query, { parentPath: input.parent_path, path: input.path, cursor: input.cursor, count: input.count, ...dateFilters(input) }); break;
    case "list_trash": result = await client.trash(input.cursor, input.count, input.sort); break;
    case "get_download_url": return { id: input.id, download_url: await client.downloadUrl(input.id) };
    case "create_folder": result = await client.createFolder(input.name, input.parent_id); break;
    case "create_upload_url": { const ticket = await client.createUploadUrl(input.file_name, input.file_size, input.parent_id, input.overwrite, input.resume, input.modified_time); return { upload_url: ticket.uploadUrl, offset: ticket.offset ?? 0, method: "POST", multipart_field: "Filedata", upload_completed: false }; }
    case "upload_text": return client.uploadBlob(new Blob([input.text], { type: "text/plain;charset=utf-8" }), input.file_name, input.parent_id, input.overwrite);
    case "upload_data": {
      const raw = input.content_base64;
      if (raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new AppError("INVALID_BASE64", "표준 Base64 파일 데이터를 입력하세요.");
      const bytes = Uint8Array.from(atob(raw), char => char.charCodeAt(0));
      if (bytes.length > 8 * 1024 * 1024) throw new AppError("UPLOAD_TOO_LARGE", "인라인 바이너리는 8MiB까지 업로드합니다. 큰 로컬 파일에는 upload_file을 사용하세요.", 413);
      return client.uploadBlob(new Blob([bytes]), input.file_name, input.parent_id, input.overwrite);
    }
    case "rename_resource": result = await client.rename(input.id, input.name); break;
    case "move_resource": result = await client.move(input.id, input.parent_id, input.overwrite); break;
    case "copy_resource": result = await client.copy(input.id, input.parent_id, input.name, input.overwrite); break;
    case "delete_resource": result = await client.deleteResource(input.id); break;
    case "restore_resource": result = await client.restore(input.id, input.overwrite); break;
    case "permanently_delete_resource": result = await client.permanentlyDelete(input.id); break;
    case "empty_trash": result = await client.emptyTrash(); break;
    case "set_favorite": result = await client.favorite(input.id, input.enabled); break;
    case "set_trash_auto_delete": result = await client.setTrashAutoDelete(input.days); break;
  }
  return { ok: true, operation: name, ...(result as Record<string, unknown>), ...(input.id ? { id: input.id } : {}) };
}
